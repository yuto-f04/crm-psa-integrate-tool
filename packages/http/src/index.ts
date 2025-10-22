import { context, trace } from "@opentelemetry/api";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { request } from "undici";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RetryPolicy {
  maxAttempts: number;
  baseMs: number;
  maxMs: number;
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  recoveryTimeMs: number;
  halfOpenMaxSuccesses: number;
}

export interface HttpClientOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  circuitBreaker: CircuitBreakerOptions;
  rateLimit: {
    points: number;
    duration: number;
  };
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

export class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failures = 0;
  private nextAttempt = 0;
  private halfOpenSuccesses = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  canRequest(now = Date.now()): boolean {
    if (this.state === "OPEN") {
      if (now >= this.nextAttempt) {
        this.state = "HALF_OPEN";
        this.halfOpenSuccesses = 0;
        return true;
      }
      return false;
    }
    return true;
  }

  recordFailure(now = Date.now()): void {
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) {
      this.state = "OPEN";
      this.nextAttempt = now + this.options.recoveryTimeMs;
      this.failures = 0;
    }
  }

  recordSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.options.halfOpenMaxSuccesses) {
        this.state = "CLOSED";
        this.failures = 0;
      }
    } else {
      this.failures = 0;
    }
  }
}

const jitter = (delay: number) => Math.random() * delay * 0.2;

const encodeQuery = (query?: Record<string, string | number | boolean | undefined>) => {
  if (!query) return "";
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined) return;
    params.append(key, String(value));
  });
  const str = params.toString();
  return str ? `?${str}` : "";
};

export class HttpClient {
  private readonly tracer = trace.getTracer("packages-http");
  private readonly rateLimiter: RateLimiterMemory;
  private readonly breaker: CircuitBreaker;

  constructor(private readonly options: HttpClientOptions) {
    this.rateLimiter = new RateLimiterMemory({
      points: options.rateLimit.points,
      duration: options.rateLimit.duration
    });
    this.breaker = new CircuitBreaker(options.circuitBreaker);
  }

  async request<T = unknown>(method: HttpMethod, path: string, opts: HttpRequestOptions = {}): Promise<T> {
    const span = this.tracer.startSpan(`http.${method.toLowerCase()}`, {
      attributes: {
        "http.method": method,
        "http.url": `${this.options.baseUrl ?? ""}${path}`
      }
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const result = await this.executeWithRetry<T>(method, path, opts);
        span.setAttribute("http.success", true);
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setAttribute("http.success", false);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async executeWithRetry<T = unknown>(method: HttpMethod, path: string, opts: HttpRequestOptions): Promise<T> {
    const { retryPolicy } = this.options;
    let attempt = 0;
    let lastError: unknown;

    while (attempt < retryPolicy.maxAttempts) {
      attempt += 1;
      const now = Date.now();
      if (!this.breaker.canRequest(now)) {
        throw new Error("Circuit breaker open");
      }

      try {
        await this.rateLimiter.consume("http-client");
        const response = await this.execute<T>(method, path, opts);
        this.breaker.recordSuccess();
        return response;
      } catch (error) {
        lastError = error;
        this.breaker.recordFailure(now);
        if (attempt >= retryPolicy.maxAttempts) {
          break;
        }
        const delay = Math.min(
          retryPolicy.baseMs * 2 ** (attempt - 1),
          retryPolicy.maxMs
        );
        await new Promise((resolve) => setTimeout(resolve, delay + jitter(delay)));
      }
    }

    throw lastError ?? new Error("HTTP request failed");
  }

  private async execute<T>(method: HttpMethod, path: string, opts: HttpRequestOptions): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const signal = opts.signal ?? controller.signal;
    try {
      const url = `${this.options.baseUrl ?? ""}${path}${encodeQuery(opts.query)}`;
      const headers = {
        "content-type": "application/json",
        ...this.options.headers,
        ...opts.headers
      };

      const body = opts.body ? JSON.stringify(opts.body) : undefined;
      const res = await request(url, {
        method,
        headers,
        body,
        signal
      });

      const text = await res.body.text();
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return text ? (JSON.parse(text) as T) : (undefined as T);
      }

      const error = new Error(`HTTP ${res.statusCode}: ${text}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
