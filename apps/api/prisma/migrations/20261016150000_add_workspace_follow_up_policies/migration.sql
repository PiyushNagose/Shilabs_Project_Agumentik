ALTER TABLE "Lead"
ADD COLUMN "leadType" TEXT,
ADD COLUMN "country" TEXT,
ADD COLUMN "priority" TEXT,
ADD COLUMN "campaign" TEXT;

CREATE INDEX "Lead_workspaceId_leadType_idx" ON "Lead"("workspaceId", "leadType");
CREATE INDEX "Lead_workspaceId_country_idx" ON "Lead"("workspaceId", "country");
CREATE INDEX "Lead_workspaceId_priority_idx" ON "Lead"("workspaceId", "priority");
CREATE INDEX "Lead_workspaceId_campaign_idx" ON "Lead"("workspaceId", "campaign");

CREATE TABLE "FollowUpPolicy" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "selectionPriority" INTEGER NOT NULL DEFAULT 0,
  "service" TEXT,
  "leadType" TEXT,
  "source" TEXT,
  "country" TEXT,
  "priority" TEXT,
  "managerId" TEXT,
  "campaign" TEXT,
  "pipelineStageId" TEXT,
  "cadenceDays" INTEGER[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUpPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FollowUpPolicy_workspaceId_name_key"
ON "FollowUpPolicy"("workspaceId", "name");
CREATE INDEX "FollowUpPolicy_workspaceId_enabled_isDefault_idx"
ON "FollowUpPolicy"("workspaceId", "enabled", "isDefault");
CREATE INDEX "FollowUpPolicy_workspaceId_selectionPriority_idx"
ON "FollowUpPolicy"("workspaceId", "selectionPriority");
CREATE UNIQUE INDEX "FollowUpPolicy_workspaceId_default_key"
ON "FollowUpPolicy"("workspaceId") WHERE "isDefault" = true;
CREATE INDEX "FollowUpPolicy_managerId_idx" ON "FollowUpPolicy"("managerId");
CREATE INDEX "FollowUpPolicy_pipelineStageId_idx" ON "FollowUpPolicy"("pipelineStageId");

ALTER TABLE "FollowUpPolicy"
ADD CONSTRAINT "FollowUpPolicy_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FollowUpPolicy"
ADD CONSTRAINT "FollowUpPolicy_managerId_fkey"
FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "FollowUpPolicy" (
  "id", "workspaceId", "name", "enabled", "isDefault", "selectionPriority",
  "cadenceDays", "createdAt", "updatedAt"
)
SELECT
  'follow_up_default_' || "id", "id", 'Default follow-up', true, true, 0,
  ARRAY[0, 1, 5, 9]::INTEGER[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Workspace";

ALTER TABLE "FollowUpSequence"
ADD COLUMN "policyId" TEXT,
ADD COLUMN "policyName" TEXT,
ADD COLUMN "policyCriteria" JSONB;

UPDATE "FollowUpSequence" AS sequence
SET
  "policyId" = policy."id",
  "policyName" = policy."name",
  "policyCriteria" = '{}'::JSONB
FROM "FollowUpPolicy" AS policy
WHERE policy."workspaceId" = sequence."workspaceId" AND policy."isDefault" = true;

CREATE INDEX "FollowUpSequence_policyId_idx" ON "FollowUpSequence"("policyId");

ALTER TABLE "FollowUpSequence"
ADD CONSTRAINT "FollowUpSequence_policyId_fkey"
FOREIGN KEY ("policyId") REFERENCES "FollowUpPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

