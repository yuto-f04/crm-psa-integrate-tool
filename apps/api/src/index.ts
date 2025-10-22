import Fastify from "fastify";
import { ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import rawBody from "fastify-raw-body";
import { mustLoadConfig } from "@crm-psa/config";
import metricsPlugin from "./plugins/metrics/index.js";
import securityPlugin from "./plugins/security.js";
import requestContextPlugin from "./plugins/request-context.js";
import queuePlugin from "./plugins/queue.js";
import integrationsPlugin from "./plugins/integrations.js";
import httpClientPlugin from "./plugins/http-client.js";
import { logger } from "./lib/logger.js";
import { registerRoutes } from "./routes/index.js";
import { registerJobs } from "./jobs/register.js";

export const buildServer = async () => {
  const config = mustLoadConfig();

  const fastify = Fastify({
    logger
  }).withTypeProvider<ZodTypeProvider>();

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(rawBody, {
    field: "rawBody",
    global: false,
    runFirst: true,
    routes: []
  });

  await fastify.register(metricsPlugin);
  await fastify.register(cookie);
  await fastify.register(jwt, {
    secret: config.AUTH_JWT_SECRET
  });
  await fastify.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute"
  });
  await fastify.register(multipart, {
    limits: {
      fileSize: config.UPLOAD_MAX_MB * 1024 * 1024
    }
  });

  await fastify.register(securityPlugin);
  await fastify.register(requestContextPlugin);
  await fastify.register(queuePlugin);
  await fastify.register(integrationsPlugin);
  await fastify.register(httpClientPlugin);

  await fastify.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "CRM-PSA Integration API",
        version: "0.1.0",
        description: "CRM/PSA E2E automation API"
      }
    },
    exposeRoute: true
  });
  await fastify.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true
    }
  });

  await registerRoutes(fastify);
  await registerJobs(fastify);
  fastify.get("/openapi.json", async () => fastify.swagger());

  return fastify;
};

if (import.meta.filename === process.argv[1]) {
  const start = async () => {
    const server = await buildServer();
    const config = mustLoadConfig();
    try {
      await server.listen({ port: 4000, host: "0.0.0.0" });
      server.log.info(`API listening on ${config.API_BASE_URL}`);
    } catch (err) {
      server.log.error(err);
      process.exit(1);
    }
  };

  start();
}
