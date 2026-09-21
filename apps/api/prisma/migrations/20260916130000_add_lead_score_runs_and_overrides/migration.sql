CREATE TYPE "LeadScoreRunSource" AS ENUM (
    'RULE_ENGINE',
    'MANUAL_OVERRIDE'
);

CREATE TYPE "LeadScoreRunStatus" AS ENUM (
    'COMPLETED',
    'SKIPPED',
    'FAILED'
);

ALTER TABLE "Lead"
ADD COLUMN "scoreOverrideAt" TIMESTAMP(3),
ADD COLUMN "scoreOverrideByUserId" TEXT,
ADD COLUMN "scoreOverrideReason" TEXT;

CREATE TABLE "LeadScoreRun" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "source" "LeadScoreRunSource" NOT NULL,
    "status" "LeadScoreRunStatus" NOT NULL,
    "score" INTEGER,
    "temperature" "LeadTemperature",
    "factors" JSONB,
    "config" JSONB,
    "qualificationSnapshot" JSONB,
    "reason" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScoreRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadScoreRun_idempotencyKey_key" ON "LeadScoreRun"("idempotencyKey");
CREATE INDEX "Lead_scoreOverrideByUserId_idx" ON "Lead"("scoreOverrideByUserId");
CREATE INDEX "LeadScoreRun_leadId_idx" ON "LeadScoreRun"("leadId");
CREATE INDEX "LeadScoreRun_actorUserId_idx" ON "LeadScoreRun"("actorUserId");
CREATE INDEX "LeadScoreRun_source_idx" ON "LeadScoreRun"("source");
CREATE INDEX "LeadScoreRun_status_idx" ON "LeadScoreRun"("status");
CREATE INDEX "LeadScoreRun_createdAt_idx" ON "LeadScoreRun"("createdAt");

ALTER TABLE "Lead"
ADD CONSTRAINT "Lead_scoreOverrideByUserId_fkey"
FOREIGN KEY ("scoreOverrideByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeadScoreRun"
ADD CONSTRAINT "LeadScoreRun_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeadScoreRun"
ADD CONSTRAINT "LeadScoreRun_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
