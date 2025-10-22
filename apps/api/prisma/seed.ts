import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@crm-psa/security";

const prisma = new PrismaClient();

const main = async () => {
  const org = await prisma.org.upsert({
    where: { slug: "demo-org" },
    update: {},
    create: {
      name: "デモ組織",
      slug: "demo-org"
    }
  });

  const users = await Promise.all(
    [
      { email: "pm@example.com", name: "プロジェクトマネージャ", role: "PM" },
      { email: "fin@example.com", name: "ファイナンス", role: "FIN" },
      { email: "dev@example.com", name: "開発担当", role: "DEV" }
    ].map(async (user) => {
      const record = await prisma.user.upsert({
        where: {
          orgId_email: {
            orgId: org.id,
            email: user.email
          }
        },
        update: {},
        create: {
          orgId: org.id,
          email: user.email,
          name: user.name,
          hashedPassword: await hashPassword("password")
        }
      });
      await prisma.role.upsert({
        where: {
          orgId_userId_role: {
            orgId: org.id,
            userId: record.id,
            role: user.role as never
          }
        },
        update: {},
        create: {
          orgId: org.id,
          userId: record.id,
          role: user.role as never
        }
      });
      return record;
    })
  );

  const meeting = await prisma.meeting.create({
    data: {
      orgId: org.id,
      title: "ローンチ準備定例",
      agenda: "WBS確認とリスクレビュー",
      recordedUrl: "https://example.com/recording.mp4",
      status: "CAPTURED"
    }
  });

  await prisma.doc.create({
    data: {
      orgId: org.id,
      meetingId: meeting.id,
      title: "ローンチ準備定例議事録",
      status: "DRAFT",
      approvalState: "pending",
      summary: "デモ用議事録のサマリです。"
    }
  });

  console.log(`Seed completed. Org: ${org.id}, Users: ${users.map((u) => u.email).join(", ")}`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
