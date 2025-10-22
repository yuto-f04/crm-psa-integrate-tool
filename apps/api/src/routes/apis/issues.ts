
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { withOrgTransaction } from "../../lib/prisma.js";

const listQuery = z.object({
  project_id: z.string().optional()
});

const patchParams = z.object({
  id: z.string().uuid()
});

const patchBody = z
  .object({
    status: z.enum(["BACKLOG", "IN_PROGRESS", "REVIEW", "DONE"]).optional(),
    sortOrder: z.number().int().optional(),
    title: z.string().optional(),
    description: z.string().nullable().optional()
  })
  .refine((data) => Object.keys(data).length > 0, "Update payload required");

const issueRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/",
    {
      schema: {
        tags: ["Issues"],
        querystring: listQuery,
        response: {
          200: z.object({
            issues: z.array(
              z.object({
                id: z.string(),
                projectId: z.string().nullable(),
                actionId: z.string().nullable(),
                title: z.string(),
                description: z.string().nullable(),
                status: z.enum(["BACKLOG", "IN_PROGRESS", "REVIEW", "DONE"]),
                sortOrder: z.number()
              })
            )
          })
        }
      }
    },
    async (request) => {
      const orgId = request.orgId;
      if (!orgId) throw fastify.httpErrors.badRequest("x-org-id header is required.");
      const query = listQuery.parse(request.query);
      const issues = await withOrgTransaction(orgId, (tx) =>
        tx.issue.findMany({
          where: {
            projectId: query.project_id ?? undefined
          },
          orderBy: { sortOrder: "asc" }
        })
      );
      return {
        issues: issues.map((issue) => ({
          id: issue.id,
          projectId: issue.projectId,
          actionId: issue.actionId,
          title: issue.title,
          description: issue.description,
          status: issue.status,
          sortOrder: issue.sortOrder
        }))
      };
    }
  );

  fastify.patch(
    "/:id",
    {
      schema: {
        tags: ["Issues"],
        params: patchParams,
        body: patchBody,
        response: {
          200: z.object({
            id: z.string(),
            status: z.enum(["BACKLOG", "IN_PROGRESS", "REVIEW", "DONE"]),
            sortOrder: z.number()
          })
        }
      }
    },
    async (request) => {
      const orgId = request.orgId;
      if (!orgId) throw fastify.httpErrors.badRequest("x-org-id header is required.");
      const params = patchParams.parse(request.params);
      const body = patchBody.parse(request.body);

      const updated = await withOrgTransaction(orgId, async (tx) => {
        const current = await tx.issue.findUnique({ where: { id: params.id } });
        if (!current) throw fastify.httpErrors.notFound("Issue not found.");

        const historySource =
          typeof current.boardHistory === "object" && current.boardHistory !== null && !Array.isArray(current.boardHistory)
            ? (current.boardHistory as Record<string, unknown>)
            : {};
        const nextHistory = {
          ...historySource,
          [new Date().toISOString()]: {
            from: current.status,
            to: body.status ?? current.status
          }
        };

        const next = await tx.issue.update({
          where: { id: params.id },
          data: {
            status: body.status ?? current.status,
            sortOrder: body.sortOrder ?? current.sortOrder,
            title: body.title ?? current.title,
            description: body.description ?? current.description,
            boardHistory: nextHistory
          }
        });
        await tx.auditEvent.create({
          data: {
            orgId,
            action: "issue.updated",
            targetType: "issue",
            targetId: next.id,
            metadata: {
              fromStatus: current.status,
              toStatus: next.status
            }
          }
        });
        return next;
      });

      return {
        id: updated.id,
        status: updated.status,
        sortOrder: updated.sortOrder
      };
    }
  );
};

export default issueRoutes;
