import { PrismaClient, UserRole, UserStatus } from "@prisma/client";
import { pipelineStages } from "./seed-data.js";

const prisma = new PrismaClient();

const developmentAdminEmail = process.env.DEV_ADMIN_EMAIL ?? "admin@example.local";
const developmentAdminPasswordHash =
  process.env.DEV_ADMIN_PASSWORD_HASH ?? "development-only-placeholder-password-hash";

async function seedPipelineStages(): Promise<void> {
  for (const stage of pipelineStages) {
    await prisma.pipelineStage.upsert({
      where: { key: stage.key },
      create: stage,
      update: {
        label: stage.label,
        order: stage.order,
        probability: stage.probability,
        isClosed: stage.isClosed,
        isWon: stage.isWon,
        isLost: stage.isLost
      }
    });
  }
}

async function seedDevelopmentAdmin(): Promise<void> {
  await prisma.user.upsert({
    where: { email: developmentAdminEmail },
    create: {
      email: developmentAdminEmail,
      passwordHash: developmentAdminPasswordHash,
      firstName: "Development",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    },
    update: {
      firstName: "Development",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
}

async function main(): Promise<void> {
  await seedPipelineStages();
  await seedDevelopmentAdmin();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("Database seed failed", error);
    await prisma.$disconnect();
    process.exit(1);
  });
