import type { FastifyInstance } from "fastify";

import healthRoutes from "./apis/health.js";
import meetingRoutes from "./apis/meetings.js";
import docRoutes from "./apis/docs.js";
import slackRoutes from "./apis/slack.js";
import webhookRoutes from "./webhooks/tldv.js";
import issueRoutes from "./apis/issues.js";
import undoRoutes from "./apis/undo.js";
import outboxRoutes from "./apis/outbox.js";
import integrationRoutes from "./apis/integrations.js";

export const registerRoutes = async (fastify: FastifyInstance) => {
  await fastify.register(healthRoutes);
  await fastify.register(webhookRoutes, { prefix: "/webhooks" });
  await fastify.register(slackRoutes, { prefix: "/slack" });
  await fastify.register(meetingRoutes, { prefix: "/meetings" });
  await fastify.register(docRoutes, { prefix: "/docs" });
  await fastify.register(issueRoutes, { prefix: "/issues" });
  await fastify.register(undoRoutes, { prefix: "/undo" });
  await fastify.register(outboxRoutes, { prefix: "/outbox" });
  await fastify.register(integrationRoutes, { prefix: "/integrations" });
};
