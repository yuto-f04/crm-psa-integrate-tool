import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { HttpClient } from "@crm-psa/http";
import { mustLoadConfig } from "@crm-psa/config";

declare module "fastify" {
  interface FastifyInstance {
    httpClient: HttpClient;
  }
}

const httpClientPlugin: FastifyPluginAsync = async (fastify) => {
  const config = mustLoadConfig();
  const client = new HttpClient({
    timeoutMs: config.HTTP_CLIENT_TIMEOUT_MS,
    baseUrl: "",
    headers: {},
    retryPolicy: {
      maxAttempts: config.RETRY_MAX_ATTEMPTS,
      baseMs: config.RETRY_BACKOFF_BASE_MS,
      maxMs: config.RETRY_BACKOFF_MAX_MS
    },
    circuitBreaker: {
      failureThreshold: 5,
      recoveryTimeMs: 30_000,
      halfOpenMaxSuccesses: 3
    },
    rateLimit: {
      points: config.RATE_LIMIT_RPS_DRIVE,
      duration: 1
    }
  });

  fastify.decorate("httpClient", client);
};

export default fp(httpClientPlugin);
