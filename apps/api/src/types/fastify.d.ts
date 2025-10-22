import type { RoleCode } from "@crm-psa/core";

declare module "fastify" {
  interface FastifyRequest {
    orgId?: string;
    requestId?: string;
    roles?: RoleCode[];
    userId?: string;
    rawBody?: string;
  }

  interface FastifyInstance {
    metrics: import("@crm-psa/metrics").Telemetry;
  }
}
