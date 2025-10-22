import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, withOrgTransaction } from "../../lib/prisma.js";

const paramsSchema = z.object({
  event_id: z.string().uuid()
});

const undoPayloadSchema = z.object({
  operations: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("doc.approval"),
        docId: z.string().uuid(),
        previous: z.object({
          status: z.string(),
          approvalState: z.string(),
          approvedAt: z.string().nullable()
        }),
        drive: z
          .object({
            fileId: z.string().nullable(),
            folderId: z.string().nullable()
          })
          .optional()
      })
    ])
  )
});

const undoRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/:event_id",
    {
      schema: {
        tags: ["Undo"],
        params: paramsSchema,
        response: {
          200: z.object({
            undone: z.boolean()
          })
        }
      }
    },
    async (request) => {
      const orgId = request.orgId;
      if (!orgId) throw fastify.httpErrors.badRequest("x-org-id header is required.");
      const params = paramsSchema.parse(request.params);
      const event = await prisma.undoEvent.findUnique({ where: { id: params.event_id } });
      if (!event || event.orgId !== orgId) {
        throw fastify.httpErrors.notFound("Undo event not found.");
      }
      if (event.reversedAt) {
        throw fastify.httpErrors.badRequest("Event already reversed.");
      }
      if (event.expiresAt < new Date()) {
        throw fastify.httpErrors.badRequest("Undo window has expired.");
      }

      const payload = undoPayloadSchema.parse(event.payload as unknown);

      await withOrgTransaction(orgId, async (tx) => {
        for (const operation of payload.operations) {
          switch (operation.type) {
            case "doc.approval": {
              await tx.doc.update({
                where: { id: operation.docId },
                data: {
                  status: operation.previous.status,
                  approvalState: operation.previous.approvalState,
                  approvedAt: operation.previous.approvedAt ? new Date(operation.previous.approvedAt) : null
                }
              });
              await tx.meeting.updateMany({
                where: { doc: { id: operation.docId } },
                data: {
                  status: operation.previous.status === "APPROVED" ? "APPROVED" : "ROUTED"
                }
              });
              if (operation.drive?.fileId && operation.drive.folderId) {
                await fastify.driveService.moveDoc(operation.drive.fileId, operation.drive.folderId);
              }
              break;
            }
            default:
              fastify.log.warn({ operation }, "Unsupported undo operation");
          }
        }

        await tx.undoEvent.update({
          where: { id: event.id },
          data: {
            reversedAt: new Date()
          }
        });

        await tx.auditEvent.create({
          data: {
            orgId,
            action: "undo.applied",
            targetType: "undo_event",
            targetId: event.id,
            metadata: payload
          }
        });
      });

      return { undone: true };
    }
  );
};

export default undoRoutes;
