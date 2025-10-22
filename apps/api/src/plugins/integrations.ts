import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { mustLoadConfig } from "@crm-psa/config";
import { SlackService } from "@crm-psa/slack";
import { DriveService } from "@crm-psa/drive";
import { suggestRouting, extractDara } from "@crm-psa/llm";

declare module "fastify" {
  interface FastifyInstance {
    slackService: SlackService;
    driveService: DriveService;
    llm: {
      suggestRouting: typeof suggestRouting;
      extractDara: typeof extractDara;
    };
  }
}

const integrationsPlugin: FastifyPluginAsync = async (fastify) => {
  const config = mustLoadConfig();
  fastify.decorate(
    "slackService",
    new SlackService({
      botToken: config.SLACK_BOT_TOKEN,
      signingSecret: config.SLACK_SIGNING_SECRET,
      interactionsUrl: config.SLACK_INTERACTIONS_URL
    })
  );

  fastify.decorate(
    "driveService",
    new DriveService({
      rootFolderId: config.GOOGLE_DRIVE_ROOT_ID,
      projectId: config.GOOGLE_PROJECT_ID,
      serviceAccountEmail: config.GOOGLE_SA_EMAIL,
      serviceAccountKeyBase64: config.GOOGLE_SA_KEY_JSON_BASE64
    })
  );

  fastify.decorate("llm", {
    suggestRouting,
    extractDara
  });
};

export default fp(integrationsPlugin);
