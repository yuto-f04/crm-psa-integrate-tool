
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { withOrgTransaction } from "../../lib/prisma.js";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const outboxRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/dlq",
    {
      schema: {
        tags: ["Outbox"],
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                topic: z.string(),
                lastError: z.string().nullable(),
                attempts: z.number(),
                updatedAt: z.date()
              })
            )
          })
        }
      }
    },
    async (request) => {
      const orgId = request.orgId;
      if (!orgId) throw fastify.httpErrors.badRequest("x-org-id header is required.");
      const items = await withOrgTransaction(orgId, (tx) =>
        tx.outboxMessage.findMany({
          where: { status: "DEAD_LETTER" },
          orderBy: { updatedAt: "desc" }
        })
      );
      return {
        items: items.map((item) => ({
          id: item.id,
          topic: item.topic,
          lastError: item.lastError,
          attempts: item.attempts,
          updatedAt: item.updatedAt
        }))
      };
    }
  );

  fastify.post(
    "/:id/retry",
    {
      schema: {
        tags: ["Outbox"],
        params: paramsSchema,
        response: {
          200: z.object({
            status: z.literal("queued")
          })
        }
      }
    },
    async (request) => {
      const orgId = request.orgId;
      if (!orgId) throw fastify.httpErrors.badRequest("x-org-id header is required.");
      const params = paramsSchema.parse(request.params);
      await withOrgTransaction(orgId, async (tx) => {
        const item = await tx.outboxMessage.findUnique({ where: { id: params.id } });
        if (!item) throw fastify.httpErrors.notFound("Outbox message not found.");
        await tx.outboxMessage.update({
          where: { id: params.id },
          data: {
            status: "PENDING",
            nextRunAt: new Date(),
            attempts: 0,
            lastError: null
          }
        });
      });
      return { status: "queued" as const };
    }
  );
};

export default outboxRoutes;
