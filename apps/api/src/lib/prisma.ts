import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "error" },
    { emit: "event", level: "warn" }
  ]
});

export type PrismaTxn = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export const withOrgTransaction = async <T>(
  orgId: string,
  handler: (tx: PrismaTxn) => Promise<T>
): Promise<T> => {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.org_id = ${orgId}::uuid`;
    return handler(tx);
  });
};
