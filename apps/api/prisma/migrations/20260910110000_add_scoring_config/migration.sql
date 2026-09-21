-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'SCORE_CHANGED';

-- CreateTable
CREATE TABLE "ScoringConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'default',
    "requirementWeight" INTEGER NOT NULL DEFAULT 20,
    "authorityWeight" INTEGER NOT NULL DEFAULT 20,
    "budgetWeight" INTEGER NOT NULL DEFAULT 20,
    "timelineWeight" INTEGER NOT NULL DEFAULT 20,
    "businessFitWeight" INTEGER NOT NULL DEFAULT 20,
    "warmThreshold" INTEGER NOT NULL DEFAULT 60,
    "hotThreshold" INTEGER NOT NULL DEFAULT 80,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoringConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScoringConfig_key_key" ON "ScoringConfig"("key");

-- CreateIndex
CREATE INDEX "ScoringConfig_key_idx" ON "ScoringConfig"("key");

-- SeedDefaultConfig
INSERT INTO "ScoringConfig" (
    "id",
    "key",
    "requirementWeight",
    "authorityWeight",
    "budgetWeight",
    "timelineWeight",
    "businessFitWeight",
    "warmThreshold",
    "hotThreshold",
    "updatedAt"
) VALUES (
    'default-scoring-config',
    'default',
    20,
    20,
    20,
    20,
    20,
    60,
    80,
    CURRENT_TIMESTAMP
) ON CONFLICT ("key") DO NOTHING;
