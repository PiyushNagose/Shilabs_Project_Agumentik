ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'OPENAI';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'GEMINI';

ALTER TYPE "IntegrationAccountStatus" ADD VALUE IF NOT EXISTS 'CONNECTED';
ALTER TYPE "IntegrationAccountStatus" ADD VALUE IF NOT EXISTS 'SYNCING';
ALTER TYPE "IntegrationAccountStatus" ADD VALUE IF NOT EXISTS 'NEEDS_ATTENTION';
ALTER TYPE "IntegrationAccountStatus" ADD VALUE IF NOT EXISTS 'FAILED';

CREATE TYPE "IntegrationHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'NEEDS_ATTENTION', 'FAILED');
CREATE TYPE "IntegrationConnectionSyncStatus" AS ENUM ('IDLE', 'SYNCING', 'SUCCEEDED', 'FAILED');

ALTER TABLE "IntegrationAccount"
  ADD COLUMN "healthStatus" "IntegrationHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "syncStatus" "IntegrationConnectionSyncStatus" NOT NULL DEFAULT 'IDLE',
  ADD COLUMN "lastHealthyAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncAt" TIMESTAMP(3),
  ADD COLUMN "disabledAt" TIMESTAMP(3);

UPDATE "IntegrationAccount"
SET "healthStatus" = CASE
  WHEN "status" = 'CONFIGURED' THEN 'HEALTHY'::"IntegrationHealthStatus"
  WHEN "status" = 'ERROR' THEN 'FAILED'::"IntegrationHealthStatus"
  ELSE 'UNKNOWN'::"IntegrationHealthStatus"
END,
"lastHealthyAt" = CASE WHEN "status" = 'CONFIGURED' THEN "lastCheckedAt" ELSE NULL END;

ALTER TABLE "IntegrationAccount"
  ADD CONSTRAINT "IntegrationAccount_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "IntegrationAccount_workspaceId_healthStatus_idx"
  ON "IntegrationAccount"("workspaceId", "healthStatus");
CREATE INDEX "IntegrationAccount_workspaceId_syncStatus_idx"
  ON "IntegrationAccount"("workspaceId", "syncStatus");
