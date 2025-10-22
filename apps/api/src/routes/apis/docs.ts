import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { withOrgTransaction } from "../../lib/prisma.js";
import { mustLoadConfig } from "@crm-psa/config";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const suggestRoutingBody = z.object({
  transcript: z.string().min(10),
  hints: z.array(z.string()).optional()
});

const extractBody = z.object({
  content: z.string().min(10),
  approve: z.boolean().default(false)
});

const docRoutes: FastifyPluginAsync = async (fastify) => {
  const config = mustLoadConfig();

  fastify.post(
    "/:id/suggest-routing",
    {
      schema: {
        tags: ["Docs"],
        params: paramsSchema,
        body: suggestRoutingBody,
        response: {
          200: z.object({
            candidates: z.array(
              z.object({
                client: z.string(),
                project: z.string(),
                confidence: z.number()
              })
            ),
            decision: z.enum(["auto_approved", "needs_review", "hold"]),
            applied: z.boolean()
          })
        }
      }
    },
    async (request) => {
      const orgId = request.orgId;
      if (!orgId) throw fastify.httpErrors.badRequest("x-org-id header is required.");
      const params = paramsSchema.parse(request.params);
      const body = suggestRoutingBody.parse(request.body);
      const candidates = fastify.llm.suggestRouting({
        transcript: body.transcript,
        hints: body.hints
      });
      const top = candidates[0];
      let decision: "auto_approved" | "needs_review" | "hold" = "hold";
      let applied = false;
      if (top.confidence >= config.LLM_AUTO_APPROVE_THRESHOLD) {
        decision = "auto_approved";
      } else if (top.confidence >= config.LLM_REVIEW_MIN_THRESHOLD) {
        decision = "needs_review";
      }

      if (decision === "auto_approved") {
        await withOrgTransaction(orgId, async (tx) => {
          await tx.meeting.update({
            where: { id: params.id },
            data: {
              routedClient: top.client,
              routedProject: top.project,
              routedConfidence: top.confidence,
              status: "ROUTED",
              routedAt: new Date()
            }
          });
          await tx.auditEvent.create({
            data: {
              orgId,
              action: "meeting.routed",
              targetType: "meeting",
              targetId: params.id,
              metadata: {
                routedClient: top.client,
                routedProject: top.project,
                confidence: top.confidence
              }
            }
          });
        });
        applied = true;
      }

      return { candidates, decision, applied };
    }
  );

  fastify.post(
    "/:id/extract-dara",
    {
      schema: {
        tags: ["Docs"],
        params: paramsSchema,
        body: extractBody,
        response: {
          200: z.object({
            decisions: z.number(),
            assumptions: z.number(),
            risks: z.number(),
            actions: z.number(),
            issuesCreated: z.number()
          })
        }
      }
    },
    async (request) => {
      const orgId = request.orgId;
      if (!orgId) throw fastify.httpErrors.badRequest("x-org-id header is required.");
      const params = paramsSchema.parse(request.params);
      const body = extractBody.parse(request.body);
      const result = fastify.llm.extractDara({
        docContent: body.content
      });

      let issuesCreated = 0;

      await withOrgTransaction(orgId, async (tx) => {
        const doc = await tx.doc.findUnique({ where: { id: params.id } });
        if (!doc) throw fastify.httpErrors.notFound("Doc not found.");
        await tx.decision.createMany({
          data: result.decisions.map((decision) => ({
            orgId,
            docId: doc.id,
            title: decision.title,
            description: decision.detail,
            confidence: decision.confidence,
            requiresReview: decision.confidence < 0.6
          }))
        });
        await tx.assumption.createMany({
          data: result.assumptions.map((assumption) => ({
            orgId,
            docId: doc.id,
            title: assumption.title,
            description: assumption.detail,
            confidence: assumption.confidence,
            requiresReview: assumption.confidence < 0.6
          }))
        });
        await tx.risk.createMany({
          data: result.risks.map((risk) => ({
            orgId,
            docId: doc.id,
            title: risk.title,
            description: risk.detail,
            confidence: risk.confidence,
            severity: risk.confidence > 0.7 ? "high" : "medium",
            requiresReview: risk.confidence < 0.6
          }))
        });
        const actionRecords = await Promise.all(
          result.actions.map((action) =>
            tx.action.create({
              data: {
                orgId,
                docId: doc.id,
                title: action.title,
                description: action.detail,
                confidence: action.confidence,
                status: "PROPOSED"
              }
            })
          )
        );

        if (body.approve) {
          for (const action of actionRecords) {
            if (action.confidence >= config.LLM_REVIEW_MIN_THRESHOLD) {
              await tx.issue.create({
                data: {
                  orgId,
                  actionId: action.id,
                  title: action.title,
                  description: action.description ?? "",
                  status: "BACKLOG",
                  sortOrder: 0
                }
              });
              issuesCreated += 1;
            }
          }
        }
      });

      return {
        decisions: result.decisions.length,
        assumptions: result.assumptions.length,
        risks: result.risks.length,
        actions: result.actions.length,
        issuesCreated
      };
    }
  );
};

export default docRoutes;
