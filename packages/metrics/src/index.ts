import { diag, DiagConsoleLogger, DiagLogLevel, metrics as otMetrics, trace, context } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

export const METRIC_NAMES = {
  apiLatencyP95: "api_latency_p95",
  dbLatencyP95: "db_latency_p95",
  webhookFailureRate: "webhook_failure_rate",
  queueLagSeconds: "queue_lag_seconds",
  pendingDocsCount: "pending_docs_count",
  mfSyncFailures: "mf_sync_failures"
} as const;

export interface TelemetryConfig {
  otlpEndpoint: string;
  serviceName: string;
  environment: string;
  logSamplingRatio: number;
}

export class Telemetry {
  private sdk: NodeSDK | null = null;

  constructor(private readonly config: TelemetryConfig) {}

  async init(): Promise<void> {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
    const metricExporter = new OTLPMetricExporter({
      url: `${this.config.otlpEndpoint}/v1/metrics`
    });

    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config.environment
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter
    }) as unknown as any;

    this.sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({
        url: `${this.config.otlpEndpoint}/v1/traces`
      }),
      metricReader,
      resource
    });
    await this.sdk.start();
  }

  get meter() {
    return otMetrics.getMeter(this.config.serviceName);
  }

  shutdown() {
    return this.sdk?.shutdown();
  }
}

export const recordHistogram = (name: string, value: number, labels: Attributes) => {
  const meter = otMetrics.getMeter("default");
  const histogram = meter.createHistogram(name);
  histogram.record(value, labels);
};

export const startSpan = (name: string, attributes: Attributes = {}) => {
  const tracer = trace.getTracer("default");
  const span = tracer.startSpan(name, { attributes });
  return {
    end: () => span.end(),
    run: <T>(fn: () => Promise<T>) => context.with(trace.setSpan(context.active(), span), fn)
  };
};
