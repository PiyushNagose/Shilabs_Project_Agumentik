import { PrismaClient, UserRole, UserStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { defaultScoringConfig, pipelineStages } from "./seed-data.js";
import { bootstrapDefaultWorkspace } from "../src/modules/workspaces/workspace.service.js";

const prisma = new PrismaClient();

const developmentAdminEmail = process.env.DEV_ADMIN_EMAIL ?? "admin@example.local";
const developmentAdminPassword = process.env.DEV_ADMIN_PASSWORD ?? "ChangeMe123!";
const bcryptSaltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);

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
  const passwordHash = await bcrypt.hash(developmentAdminPassword, bcryptSaltRounds);

  await prisma.user.upsert({
    where: { email: developmentAdminEmail },
    create: {
      email: developmentAdminEmail,
      passwordHash,
      firstName: "Development",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    },
    update: {
      passwordHash,
      firstName: "Development",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
}

async function seedScoringConfig(): Promise<void> {
  await prisma.scoringConfig.upsert({
    where: { key: defaultScoringConfig.key },
    create: defaultScoringConfig,
    update: defaultScoringConfig
  });
}

async function main(): Promise<void> {
  await seedPipelineStages();
  await seedDevelopmentAdmin();
  await bootstrapDefaultWorkspace();
  await seedScoringConfig();
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
