import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/health",
    {
      schema: {
        tags: ["Health"],
        response: {
          200: z.object({
            status: z.literal("ok"),
            timestamp: z.number()
          })
        }
      }
    },
    async () => ({
      status: "ok" as const,
      timestamp: Date.now()
    })
  );
};

export default healthRoutes;
