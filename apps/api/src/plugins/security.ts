import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import csrf from "@fastify/csrf-protection";
import sensible from "@fastify/sensible";
import underPressure from "@fastify/under-pressure";
import { mustLoadConfig } from "@crm-psa/config";

const security: FastifyPluginAsync = async (fastify) => {
  const config = mustLoadConfig();
  await fastify.register(sensible);

  await fastify.register(cors, {
    origin: config.CORS_ALLOWED_ORIGINS.split(","),
    credentials: true
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [config.CSP_DEFAULT_SRC],
        imgSrc: config.CSP_IMG_SRC.split(" "),
        scriptSrc: config.CSP_SCRIPT_SRC.split(" ")
      }
    },
    crossOriginResourcePolicy: { policy: "same-origin" }
  });

  if (config.CSRF_MODE !== "none") {
    await fastify.register(csrf, {
      cookieOpts: {
        httpOnly: true,
        sameSite: "lax"
      }
    });
  }

  await fastify.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxRssBytes: 1024 * 1024 * 1024,
    exposeStatusRoute: true
  });
};

export default fp(security);
