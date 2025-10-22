import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { createQueueManager } from "@crm-psa/queue";
import { mustLoadConfig } from "@crm-psa/config";

declare module "fastify" {
  interface FastifyInstance {
    queueManager: ReturnType<typeof createQueueManager>;
  }
}

const queuePlugin: FastifyPluginAsync = async (fastify) => {
  const config = mustLoadConfig();
  const manager = createQueueManager({
    connection: config.REDIS_URL ?? "redis://localhost:6379",
    defaultJobOptions: {
      attempts: config.RETRY_MAX_ATTEMPTS,
      backoff: {
        type: "exponential",
        delay: config.RETRY_BACKOFF_BASE_MS
      },
      removeOnComplete: true,
      removeOnFail: false
    }
  });
  await manager.connect().catch((err) => {
    fastify.log.warn({ err }, "Redis に接続できません。キューはモックモードで動作します。");
  });
  fastify.decorate("queueManager", manager);
};

export default fp(queuePlugin);
