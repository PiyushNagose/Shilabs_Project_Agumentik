ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'TASK_CREATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'TASK_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'TASK_COMPLETED';
ALTER TYPE "AuditActorType" ADD VALUE IF NOT EXISTS 'AGENT';
ALTER TYPE "AuditActorType" ADD VALUE IF NOT EXISTS 'WORKFLOW';
ALTER TYPE "AuditActorType" ADD VALUE IF NOT EXISTS 'PROVIDER';

CREATE TYPE "ActivityVisibility" AS ENUM ('BUSINESS', 'INTERNAL');
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "TaskCreatorType" AS ENUM ('USER', 'SYSTEM', 'AGENT', 'WORKFLOW');

ALTER TABLE "Activity"
  ADD COLUMN "entityType" TEXT NOT NULL DEFAULT 'LEAD',
  ADD COLUMN "entityId" TEXT,
  ADD COLUMN "actorType" "AuditActorType" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "actorAgentId" TEXT,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "correlationId" TEXT,
  ADD COLUMN "visibility" "ActivityVisibility" NOT NULL DEFAULT 'BUSINESS';

UPDATE "Activity"
SET "entityId" = "leadId",
    "actorType" = CASE WHEN "actorUserId" IS NULL THEN 'SYSTEM'::"AuditActorType" ELSE 'USER'::"AuditActorType" END,
    "title" = INITCAP(REPLACE("type"::TEXT, '_', ' ')),
    "occurredAt" = "createdAt"
WHERE "entityId" IS NULL;

ALTER TABLE "AuditEvent"
  ADD COLUMN "actorUserId" TEXT,
  ADD COLUMN "actorAgentId" TEXT,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "correlationId" TEXT,
  ADD COLUMN "visibility" "ActivityVisibility" NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "AuditEvent"
SET "actorUserId" = CASE WHEN "actorType" = 'USER' THEN "actorId" ELSE NULL END,
    "occurredAt" = "createdAt";

CREATE TABLE "Task" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
  "dueAt" TIMESTAMP(3),
  "reminderAt" TIMESTAMP(3),
  "assignedToUserId" TEXT,
  "createdByType" "TaskCreatorType" NOT NULL,
  "createdByUserId" TEXT,
  "createdByAgentId" TEXT,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "leadId" TEXT,
  "contactId" TEXT,
  "companyId" TEXT,
  "dealId" TEXT,
  "isNextAction" BOOLEAN NOT NULL DEFAULT false,
  "projectionKey" TEXT,
  "completedAt" TIMESTAMP(3),
  "completedByType" "TaskCreatorType",
  "completedByUserId" TEXT,
  "metadata" JSONB,
  "correlationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Task_projectionKey_key" ON "Task"("projectionKey");
CREATE INDEX "Activity_entityType_entityId_occurredAt_idx" ON "Activity"("entityType", "entityId", "occurredAt");
CREATE INDEX "Activity_sourceType_sourceId_idx" ON "Activity"("sourceType", "sourceId");
CREATE INDEX "Activity_correlationId_idx" ON "Activity"("correlationId");
CREATE INDEX "Activity_visibility_occurredAt_idx" ON "Activity"("visibility", "occurredAt");
CREATE INDEX "AuditEvent_sourceType_sourceId_idx" ON "AuditEvent"("sourceType", "sourceId");
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");
CREATE INDEX "Task_workspaceId_status_dueAt_idx" ON "Task"("workspaceId", "status", "dueAt");
CREATE INDEX "Task_workspaceId_assignedToUserId_status_idx" ON "Task"("workspaceId", "assignedToUserId", "status");
CREATE INDEX "Task_leadId_status_dueAt_idx" ON "Task"("leadId", "status", "dueAt");
CREATE INDEX "Task_contactId_idx" ON "Task"("contactId");
CREATE INDEX "Task_companyId_idx" ON "Task"("companyId");
CREATE INDEX "Task_dealId_idx" ON "Task"("dealId");
CREATE INDEX "Task_sourceType_sourceId_idx" ON "Task"("sourceType", "sourceId");
CREATE INDEX "Task_correlationId_idx" ON "Task"("correlationId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Task" (
  "id", "workspaceId", "title", "status", "priority", "dueAt", "assignedToUserId",
  "createdByType", "sourceType", "sourceId", "leadId", "isNextAction", "projectionKey",
  "metadata", "createdAt", "updatedAt"
)
SELECT
  'legacy_next_action_' || MD5(l."id"), l."workspaceId", l."nextAction", 'OPEN', 'NORMAL',
  l."nextActionAt", l."ownerId", 'SYSTEM', 'LEGACY_NEXT_ACTION', l."id", l."id", true,
  'lead:' || l."id" || ':next-action', '{"migrated":true}'::JSONB, l."updatedAt", l."updatedAt"
FROM "Lead" l
WHERE l."workspaceId" IS NOT NULL AND l."nextAction" IS NOT NULL;

CREATE OR REPLACE FUNCTION sync_lead_next_action_task() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."workspaceId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."nextAction" IS NULL THEN
    UPDATE "Task"
    SET "status" = 'COMPLETED', "completedAt" = COALESCE("completedAt", CURRENT_TIMESTAMP),
        "completedByType" = COALESCE("completedByType", 'SYSTEM'), "updatedAt" = CURRENT_TIMESTAMP
    WHERE "projectionKey" = 'lead:' || NEW."id" || ':next-action'
      AND "status" IN ('OPEN', 'IN_PROGRESS');
  ELSE
    INSERT INTO "Task" (
      "id", "workspaceId", "title", "status", "priority", "dueAt", "assignedToUserId",
      "createdByType", "sourceType", "sourceId", "leadId", "isNextAction", "projectionKey",
      "createdAt", "updatedAt"
    ) VALUES (
      'legacy_next_action_' || MD5(NEW."id"), NEW."workspaceId", NEW."nextAction", 'OPEN', 'NORMAL',
      NEW."nextActionAt", NEW."ownerId", 'SYSTEM', 'LEGACY_NEXT_ACTION', NEW."id", NEW."id", true,
      'lead:' || NEW."id" || ':next-action', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("projectionKey") DO UPDATE SET
      "workspaceId" = EXCLUDED."workspaceId", "title" = EXCLUDED."title", "status" = 'OPEN',
      "dueAt" = EXCLUDED."dueAt", "assignedToUserId" = EXCLUDED."assignedToUserId",
      "completedAt" = NULL, "completedByType" = NULL, "completedByUserId" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Lead_next_action_task_sync"
AFTER INSERT OR UPDATE OF "nextAction", "nextActionAt", "ownerId", "workspaceId" ON "Lead"
FOR EACH ROW EXECUTE FUNCTION sync_lead_next_action_task();
