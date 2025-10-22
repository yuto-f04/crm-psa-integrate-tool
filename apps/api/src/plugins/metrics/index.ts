import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { Telemetry } from "@crm-psa/metrics";
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

  fastify.addHook("onClose", async () => {
    await telemetry.shutdown().catch(() => undefined);
  });
};

export default fp(metricsPlugin);
