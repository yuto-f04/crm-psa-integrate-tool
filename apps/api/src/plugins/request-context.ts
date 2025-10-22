import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { createRequestId, parseOrgId } from "@crm-psa/security";

const OPEN_ROUTES = new Set(["/health", "/openapi.json", "/docs", "/docs/*", "/slack/interactions", "/webhooks/tldv"]);

const requestContext: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", async (request, reply) => {
    request.requestId = createRequestId();
    reply.header("x-request-id", request.requestId);
    const routePath = request.routerPath ?? request.url;
    if (OPEN_ROUTES.has(routePath)) {
      return;
    }
    const orgId = request.headers["x-org-id"];
    request.orgId = parseOrgId(Array.isArray(orgId) ? orgId[0] : orgId);
  });
};

export default fp(requestContext);
