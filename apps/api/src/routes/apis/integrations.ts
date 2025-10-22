import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { withOrgTransaction } from "../../lib/prisma.js";

const integrationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/",
    {
      schema: {
        tags: ["Integrations"],
        response: {
          200: z.object({
            integrations: z.array(
              z.object({
                type: z.string(),
                status: z.string(),
                updatedAt: z.date().nullable()
              })
            )
          })
        }
      }
    },
    async (request) => {
      const orgId = request.orgId;
      if (!orgId) throw fastify.httpErrors.badRequest("x-org-id header is required.");
      const integrations = await withOrgTransaction(orgId, (tx) =>
        tx.integration.findMany({
          orderBy: { updatedAt: "desc" }
        })
      );
      return {
        integrations: integrations.map((item) => ({
          type: item.type,
          status: item.status,
          updatedAt: item.updatedAt
        }))
      };
    }
  );

  fastify.post(
    "/money-forward/test",
    {
      schema: {
        tags: ["Integrations"],
        response: {
          200: z.object({
            status: z.literal("pending"),
            message: z.string()
          })
        }
      }
    },
    async (request) => {
      const orgId = request.orgId;
      if (!orgId) throw fastify.httpErrors.badRequest("x-org-id header is required.");
      // Placeholder for future Money Forward connectivity check
      await withOrgTransaction(orgId, async (tx) => {
        await tx.integration.upsert({
          where: {
            orgId_type: {
              orgId,
              type: "MF"
            }
          },
          update: {
            status: "pending",
            metadata: {
              message: "後段接続: 現在は未実装です。"
            }
          },
          create: {
            orgId,
            type: "MF",
            status: "pending",
            metadata: {
              message: "後段接続: 現在は未実装です。"
            }
          }
        });
      });

      return {
        status: "pending",
        message: "Money Forward 接続は後段実装です。"
      };
    }
  );

  fastify.post(
    "/github/test",
    {
      schema: {
        tags: ["Integrations"],
        response: {
          200: z.object({
            status: z.literal("pending"),
            message: z.string()
          })
        }
      }
    },
    async (request) => {
      const orgId = request.orgId;
      if (!orgId) throw fastify.httpErrors.badRequest("x-org-id header is required.");
      await withOrgTransaction(orgId, async (tx) => {
        await tx.integration.upsert({
          where: {
            orgId_type: {
              orgId,
              type: "GITHUB"
            }
          },
          update: {
            status: "pending",
            metadata: {
              message: "後段接続: 現在は未実装です。"
            }
          },
          create: {
            orgId,
            type: "GITHUB",
            status: "pending",
            metadata: {
              message: "後段接続: 現在は未実装です。"
            }
          }
        });
      });

      return {
        status: "pending",
        message: "GitHub 接続は後段実装です。"
      };
    }
  );
};

export default integrationRoutes;
