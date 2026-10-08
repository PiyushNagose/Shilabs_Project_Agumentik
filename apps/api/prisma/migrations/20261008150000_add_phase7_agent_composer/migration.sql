ALTER TABLE "Agent" ADD COLUMN "draftVersionId" TEXT;

CREATE INDEX "Agent_draftVersionId_idx" ON "Agent"("draftVersionId");

ALTER TABLE "Agent" ADD CONSTRAINT "Agent_draftVersionId_fkey"
FOREIGN KEY ("draftVersionId") REFERENCES "AgentVersion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Agent" AS agent
SET "draftVersionId" = agent."currentVersionId"
FROM "AgentVersion" AS version
WHERE version."id" = agent."currentVersionId"
  AND version."publishedAt" IS NULL;
