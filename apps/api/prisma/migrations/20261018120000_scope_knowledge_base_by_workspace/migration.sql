-- Ensure the compatibility workspace exists before assigning legacy knowledge.
INSERT INTO "Workspace" ("id", "name", "slug", "status", "createdAt", "updatedAt")
VALUES ('workspace_default', 'Default Workspace', 'default', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Add ownership as nullable only for the duration of the legacy backfill.
ALTER TABLE "KnowledgeBaseEntry" ADD COLUMN "workspaceId" TEXT;

UPDATE "KnowledgeBaseEntry"
SET "workspaceId" = (
  SELECT "id"
  FROM "Workspace"
  WHERE "slug" = 'default'
  LIMIT 1
)
WHERE "workspaceId" IS NULL;

ALTER TABLE "KnowledgeBaseEntry" ALTER COLUMN "workspaceId" SET NOT NULL;

DROP INDEX "KnowledgeBaseEntry_key_key";

CREATE UNIQUE INDEX "KnowledgeBaseEntry_workspaceId_key_key"
ON "KnowledgeBaseEntry"("workspaceId", "key");

CREATE INDEX "KnowledgeBaseEntry_workspaceId_category_idx"
ON "KnowledgeBaseEntry"("workspaceId", "category");

CREATE INDEX "KnowledgeBaseEntry_workspaceId_status_idx"
ON "KnowledgeBaseEntry"("workspaceId", "status");

ALTER TABLE "KnowledgeBaseEntry"
ADD CONSTRAINT "KnowledgeBaseEntry_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
