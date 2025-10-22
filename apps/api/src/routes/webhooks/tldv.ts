
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { mustLoadConfig } from "@crm-psa/config";
import { withOrgTransaction } from "../../lib/prisma.js";

const tldvBodySchema = z.object({
  id: z.string(),
  meetingExternalId: z.string(),
  title: z.string(),
  startedAt: z.string().optional(),
  transcript: z.string().optional(),
  recordingUrl: z.string().optional(),
  account: z.string().optional(),
  project: z.string().optional()
});

const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/tldv",
    {
      config: {
        rawBody: true
      },
      schema: {
        tags: ["Webhooks"],
        body: tldvBodySchema
      }
    },
    async (request, reply) => {
      const rawBody = request.rawBody;
      if (!rawBody) {
        throw fastify.httpErrors.badRequest("raw body is required");
      }

      const signatureHeader = request.headers["x-tldv-signature"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      if (!signature) {
        throw fastify.httpErrors.unauthorized("signature header missing");
      }
      const config = mustLoadConfig();
      if (!config.TLDV_WEBHOOK_SECRET) {
        throw fastify.httpErrors.internalServerError("Webhook secret is not configured.");
      }
      const computed = crypto.createHmac("sha256", config.TLDV_WEBHOOK_SECRET).update(rawBody).digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(signature, "utf8"))) {
        throw fastify.httpErrors.unauthorized("signature mismatch");
      }

      const orgIdHeader = request.headers["x-org-id"];
      if (!orgIdHeader || Array.isArray(orgIdHeader)) {
        throw fastify.httpErrors.badRequest("x-org-id header is required.");
      }
      const body = tldvBodySchema.parse(request.body);
      const orgId = orgIdHeader;

      const { meeting, doc, outbox } = await withOrgTransaction(orgId, async (tx) => {
        const meetingRecord = await tx.meeting.upsert({
          where: { tldvExternalId: body.meetingExternalId },
          update: {
            title: body.title,
            recordedUrl: body.recordingUrl ?? null,
            agenda: body.project ?? null,
            scheduledAt: body.startedAt ? new Date(body.startedAt) : null
          },
          create: {
            orgId,
            title: body.title,
            recordedUrl: body.recordingUrl ?? null,
            tldvExternalId: body.meetingExternalId,
            agenda: body.project ?? null,
            scheduledAt: body.startedAt ? new Date(body.startedAt) : null,
            status: "CAPTURED"
          }
        });

        const docRecord = await tx.doc.upsert({
          where: { meetingId: meetingRecord.id },
          update: {
            summary: body.transcript ?? null,
            title: body.title
          },
          create: {
            orgId,
            meetingId: meetingRecord.id,
            title: body.title,
            summary: body.transcript ?? null,
            status: "DRAFT",
            approvalState: "pending"
          }
        });

        const outboxRecord = await tx.outboxMessage.create({
          data: {
            orgId,
            topic: "slack.approval-request",
            payloadJson: {
              meetingId: meetingRecord.id,
              docId: docRecord.id,
              title: body.title,
              routedClient: body.account ?? null,
              routedProject: body.project ?? null,
              confidence: null
            },
            attempts: 0,
            nextRunAt: new Date(),
            status: "PENDING",
            idempotencyKey: `slack-${body.meetingExternalId}`
          }
        });

        await tx.auditEvent.create({
          data: {
            orgId,
            action: "webhook.tldv.received",
            targetType: "meeting",
            targetId: meetingRecord.id,
            metadata: {
              meetingExternalId: body.meetingExternalId
            }
          }
        });
        return { meeting: meetingRecord, doc: docRecord, outbox: outboxRecord };
      });

      await fastify.queueManager.enqueue(
        "drive-doc-create",
        {
          meetingId: meeting.id,
          orgId,
          title: body.title,
          account: body.account ?? "未分類",
          project: body.project ?? "未分類",
          date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
          transcript: body.transcript ?? ""
        },
        {
          jobId: `drive-doc-${meeting.id}`,
          delay: 1000
        }
      );

      await fastify.queueManager.enqueue("outbox-dispatch", {
        outboxId: outbox.id,
        orgId
      });

      return reply.status(202).send({ status: "accepted" });
    }
  );
};

export default webhookRoutes;
