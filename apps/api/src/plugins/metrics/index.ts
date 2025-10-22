import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { Telemetry, METRIC_NAMES } from "@crm-psa/metrics";
import { mustLoadConfig } from "@crm-psa/config";

const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  const config = mustLoadConfig();
  const telemetry = new Telemetry({
    otlpEndpoint: config.OTLP_ENDPOINT,
    serviceName: "crm-psa-api",
    environment: config.APP_ENV,
    logSamplingRatio: config.LOG_SAMPLING_RATIO
  });
  await telemetry.init().catch(() => {
    fastify.log.warn("Telemetry initialisation failed, continuing without OTLP exporter");
  });
  fastify.decorate("metrics", telemetry);

  try {
    const meter = telemetry.meter;
    const apiLatency = meter.createHistogram(METRIC_NAMES.apiLatencyP95, {
      unit: "milliseconds"
    });
    fastify.addHook("onResponse", (request, reply, done) => {
      const start = (request as unknown as { startTime?: bigint }).startTime;
      if (start) {
        const duration = Number(process.hrtime.bigint() - start) / 1_000_000;
        apiLatency.record(duration, {
          route: request.routerPath ?? request.url,
          status: reply.statusCode
        });
      }
      done();
    });
  } catch (error) {
    fastify.log.debug({ err: error }, "Failed to initialise request latency metric");
  }

  fastify.addHook("onRequest", (request, _reply, done) => {
    (request as unknown as { startTime?: bigint }).startTime = process.hrtime.bigint();
    done();
  });

  fastify.addHook("onClose", async () => {
    await telemetry.shutdown().catch(() => undefined);
  });
};

export default fp(metricsPlugin);
