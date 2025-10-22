import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, withOrgTransaction } from "../../lib/prisma.js";

const meetingParams = z.object({
  id: z.string().uuid()
});

const meetingResponse = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  docsLink: z.string().nullable(),
  routedClient: z.string().nullable(),
  routedProject: z.string().nullable(),
  routedConfidence: z.number().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

const meetingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/",
    {
      schema: {
        tags: ["Meetings"],
        response: {
          200: z.object({
            meetings: z.array(meetingResponse)
          })
        }
      }
    },
    async (request) => {
      const orgId = request.orgId;
      if (!orgId) throw fastify.httpErrors.badRequest("x-org-id が必要です。");
      const meetings = await withOrgTransaction(orgId, (tx) =>
        tx.meeting.findMany({
          orderBy: { createdAt: "desc" }
        })
      );
      return {
        meetings: meetings.map((meeting) => ({
          id: meeting.id,
          title: meeting.title,
          status: meeting.status,
          docsLink: meeting.docsLink,
          routedClient: meeting.routedClient,
          routedProject: meeting.routedProject,
          routedConfidence: meeting.routedConfidence,
          createdAt: meeting.createdAt,
          updatedAt: meeting.updatedAt
        }))
      };
    }
  );

  fastify.get(
    "/:id",
    {
      schema: {
        tags: ["Meetings"],
        params: meetingParams,
        response: {
          200: meetingResponse
        }
      }
    },
    async (request) => {
      const orgId = request.orgId;
      if (!orgId) throw fastify.httpErrors.badRequest("x-org-id が必要です。");
      const params = meetingParams.parse(request.params);
      const meeting = await withOrgTransaction(orgId, (tx) =>
        tx.meeting.findUnique({
          where: { id: params.id }
        })
      );
      if (!meeting) throw fastify.httpErrors.notFound("会議が見つかりません。");
      return {
        id: meeting.id,
        title: meeting.title,
        status: meeting.status,
        docsLink: meeting.docsLink,
        routedClient: meeting.routedClient,
        routedProject: meeting.routedProject,
        routedConfidence: meeting.routedConfidence,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt
      };
    }
  );
};

export default meetingRoutes;
