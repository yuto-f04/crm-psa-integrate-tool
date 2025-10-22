import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { slackInteractionSchema } from "@crm-psa/slack";
import { withOrgTransaction } from "../../lib/prisma.js";

const actionPayloadSchema = z.object({
  meetingId: z.string().uuid(),
  docId: z.string().uuid(),
  orgId: z.string().uuid(),
  action: z.enum(["approve", "hold"])
});

const slackRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/interactions",
    {
      config: {
        rawBody: true
      },
      schema: {
        tags: ["Slack"],
        consumes: ["application/x-www-form-urlencoded"]
      }
    },
    async (request, reply) => {
      const rawBody = request.rawBody;
      if (!rawBody) {
        throw fastify.httpErrors.badRequest("Request body is required.");
      }

      fastify.slackService.verifyRequest(request.headers as Record<string, string>, rawBody);

      const payloadEncoded = new URLSearchParams(rawBody).get("payload");
      if (!payloadEncoded) {
        throw fastify.httpErrors.badRequest("Slack payload is missing.");
      }
      const payload = slackInteractionSchema.parse(JSON.parse(payloadEncoded));
      const action = actionPayloadSchema.parse(JSON.parse(payload.actions[0]?.value ?? "{}"));

      const meeting = await withOrgTransaction(action.orgId, (tx) =>
        tx.meeting.findUnique({
          where: { id: action.meetingId },
          include: { doc: true }
        })
      );
      if (!meeting || !meeting.doc) {
        throw fastify.httpErrors.notFound("Meeting or document not found.");
      }

      if (action.action === "approve") {
        try {
          if (meeting.doc.driveFileId && meeting.doc.driveFolderId) {
            await fastify.driveService.moveDoc(meeting.doc.driveFileId, meeting.doc.driveFolderId);
          }

          const undoPayload = {
            operations: [
              {
                type: "doc.approval" as const,
                docId: meeting.doc.id,
                previous: {
                  status: meeting.doc.status,
                  approvalState: meeting.doc.approvalState,
                  approvedAt: meeting.doc.approvedAt ? meeting.doc.approvedAt.toISOString() : null
                },
                drive: {
                  fileId: meeting.doc.driveFileId,
                  folderId: meeting.doc.driveFolderId
                }
              }
            ]
          };

          await withOrgTransaction(action.orgId, async (tx) => {
            await tx.doc.update({
              where: { id: meeting.doc!.id },
              data: {
                status: "APPROVED",
                approvalState: "approved",
                approvedAt: new Date()
              }
            });
            await tx.meeting.update({
              where: { id: meeting.id },
              data: {
                status: "APPROVED",
                docsLink: meeting.doc!.driveFileId
                  ? `https://docs.google.com/document/d/${meeting.doc!.driveFileId}`
                  : meeting.docsLink
              }
            });
            await tx.auditEvent.create({
              data: {
                orgId: action.orgId,
                action: "doc.approved",
                targetType: "doc",
                targetId: meeting.doc!.id,
                metadata: {
                  approverSlackId: payload.user.id
                }
              }
            });
            await tx.undoEvent.create({
              data: {
                orgId: action.orgId,
                targetTable: "docs",
                targetId: meeting.doc!.id,
                payload: undoPayload as unknown as Record<string, unknown>,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
              }
            });
          });

          return reply.send({
            response_type: "ephemeral",
            text: "承認が完了しました。DriveとDBを更新しました。"
          });
        } catch (error) {
          fastify.log.error({ err: error }, "Drive move failed");
          await fastify.queueManager.enqueue("drive-retry", {
            docId: meeting.doc.id,
            meetingId: meeting.id,
            orgId: action.orgId
          });
          return reply.send({
            response_type: "ephemeral",
            text: "Driveの移動に失敗しました。DBは変更されていません。再試行してください。"
          });
        }
      }

      await withOrgTransaction(action.orgId, async (tx) => {
        await tx.doc.update({
          where: { id: meeting.doc!.id },
          data: {
            approvalState: "pending",
            status: "REVIEW"
          }
        });
      });
      return reply.send({ text: "保留として処理しました。" });
    }
  );
};

export default slackRoutes;
