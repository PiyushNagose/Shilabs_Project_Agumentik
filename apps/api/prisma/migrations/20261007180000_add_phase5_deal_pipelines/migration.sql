-- Phase 5 keeps legacy stage keys/order stable while adding workspace pipelines
-- and an independent per-pipeline position used by the CRM board.
CREATE TYPE "PipelineStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "PipelineStageStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "Pipeline" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SALES',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "PipelineStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PipelineStage"
  ADD COLUMN "pipelineId" TEXT,
  ADD COLUMN "semanticKey" TEXT,
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "color" TEXT,
  ADD COLUMN "status" "PipelineStageStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "Deal"
  ADD COLUMN "pipelineId" TEXT,
  ADD COLUMN "closeDate" TIMESTAMP(3);

INSERT INTO "Pipeline" ("id", "workspaceId", "name", "type", "isDefault", "status", "createdAt", "updatedAt")
SELECT 'pipeline_' || md5(w."id"), w."id", 'Sales Pipeline', 'SALES', true, 'ACTIVE'::"PipelineStatus", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Workspace" w
ON CONFLICT DO NOTHING;

WITH ranked_stages AS (
  SELECT s."id", p."id" AS "pipelineId",
         ROW_NUMBER() OVER (PARTITION BY s."workspaceId" ORDER BY s."order", s."id") - 1 AS "position"
  FROM "PipelineStage" s
  JOIN "Pipeline" p ON p."workspaceId" = s."workspaceId" AND p."isDefault" = true
  WHERE s."pipelineId" IS NULL
)
UPDATE "PipelineStage" s
SET "pipelineId" = ranked."pipelineId",
    "position" = ranked."position",
    "semanticKey" = s."key"
FROM ranked_stages ranked
WHERE ranked."id" = s."id";

UPDATE "Deal" d
SET "pipelineId" = s."pipelineId"
FROM "PipelineStage" s
WHERE s."id" = d."stageId" AND d."pipelineId" IS NULL;

CREATE UNIQUE INDEX "Pipeline_workspaceId_name_key" ON "Pipeline"("workspaceId", "name");
CREATE INDEX "Pipeline_workspaceId_status_idx" ON "Pipeline"("workspaceId", "status");
CREATE INDEX "PipelineStage_pipelineId_position_idx" ON "PipelineStage"("pipelineId", "position");
CREATE UNIQUE INDEX "PipelineStage_pipelineId_semanticKey_key" ON "PipelineStage"("pipelineId", "semanticKey");
CREATE INDEX "Deal_pipelineId_stageId_idx" ON "Deal"("pipelineId", "stageId");

ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
