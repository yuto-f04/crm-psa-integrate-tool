
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withOrgTransaction } from "../lib/prisma.js";
import { mustLoadConfig } from "@crm-psa/config";

const slackOutboxPayload = z.object({
  meetingId: z.string().uuid(),
  docId: z.string().uuid(),
  title: z.string(),
  routedClient: z.string().nullable(),
  routedProject: z.string().nullable(),
  confidence: z.number().nullable()
});

export const registerJobs = async (fastify: FastifyInstance) => {
  const config = mustLoadConfig();

  fastify.queueManager.registerWorker(
    "drive-doc-create",
    async (job) => {
      const data = z
        .object({
          meetingId: z.string().uuid(),
          orgId: z.string().uuid(),
          title: z.string(),
          account: z.string(),
          project: z.string(),
          date: z.string(),
          transcript: z.string()
        })
        .parse(job.data);
      const docResult = await fastify.driveService.createMeetingDoc({
        account: data.account,
        project: data.project,
        title: data.title,
        date: data.date,
        content: data.transcript
      });

      await withOrgTransaction(data.orgId, async (tx) => {
        await tx.doc.update({
          where: { meetingId: data.meetingId },
          data: {
            driveFileId: docResult.fileId,
            driveFolderId: docResult.folderId,
            status: "DRAFT",
            summary: data.transcript
          }
        });
        await tx.meeting.update({
          where: { id: data.meetingId },
          data: {
            docsLink: docResult.link
          }
        });
        await tx.auditEvent.create({
          data: {
            orgId: data.orgId,
            action: "drive.doc.created",
            targetType: "doc",
            targetId: docResult.fileId,
            metadata: {
              meetingId: data.meetingId
            }
          }
        });
      });
    },
    { concurrency: 2 }
  );

  fastify.queueManager.registerWorker(
    "drive-retry",
    async (job) => {
      const data = z
        .object({
          meetingId: z.string().uuid(),
          docId: z.string().uuid(),
          orgId: z.string().uuid()
        })
        .parse(job.data);
      await withOrgTransaction(data.orgId, async (tx) => {
        const doc = await tx.doc.findUnique({ where: { id: data.docId } });
        if (!doc || !doc.driveFileId || !doc.driveFolderId) {
          return;
        }
        await fastify.driveService.moveDoc(doc.driveFileId, doc.driveFolderId);
      });
    },
    { concurrency: 1 }
  );

  fastify.queueManager.registerWorker(
    "outbox-dispatch",
    async (job) => {
      const data = z
        .object({
          outboxId: z.string().uuid(),
          orgId: z.string().uuid()
        })
        .parse(job.data);

      await withOrgTransaction(data.orgId, async (tx) => {
        const message = await tx.outboxMessage.findUnique({ where: { id: data.outboxId } });
        if (!message) return;
        if (message.status === "COMPLETED") return;

        try {
          if (message.topic === "slack.approval-request") {
            const payload = slackOutboxPayload.parse(message.payloadJson as unknown);
            await fastify.slackService.postApproval(config.ALERT_SLACK_CHANNEL, {
              orgId: data.orgId,
              meetingId: payload.meetingId,
              docId: payload.docId,
              routedClient: payload.routedClient ?? undefined,
              routedProject: payload.routedProject ?? undefined,
              confidence: payload.confidence ?? undefined,
              approverRole: "PM"
            });
          }

          await tx.outboxMessage.update({
            where: { id: message.id },
            data: {
              status: "COMPLETED",
              attempts: message.attempts + 1,
              lastError: null
            }
          });
        } catch (error) {
          const attempts = message.attempts + 1;
          const status = attempts >= config.RETRY_MAX_ATTEMPTS ? "DEAD_LETTER" : "FAILED";
          await tx.outboxMessage.update({
            where: { id: message.id },
            data: {
              status,
              attempts,
              lastError: (error as Error).message,
              nextRunAt: new Date(Date.now() + config.RETRY_BACKOFF_BASE_MS)
            }
          });
          throw error;
        }
      });
    },
    { concurrency: 2 }
  );
};
