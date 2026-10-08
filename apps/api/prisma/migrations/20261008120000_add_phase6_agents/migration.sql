CREATE TYPE "AgentType" AS ENUM ('OUTREACH', 'REPLY_UNDERSTANDING', 'QUALIFICATION', 'PROPOSAL', 'MEETING', 'VOICE', 'WHATSAPP', 'SALES_COPILOT');
CREATE TYPE "AgentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "AgentExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "AgentType" NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "modelConfig" JSONB,
    "toolsConfig" JSONB,
    "knowledgeConfig" JSONB,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentExecution" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceEntityType" TEXT,
    "sourceEntityId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "leadId" TEXT,
    "status" "AgentExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "summary" TEXT,
    "result" JSONB,
    "evaluation" JSONB,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Agent_workspaceId_key_key" ON "Agent"("workspaceId", "key");
CREATE INDEX "Agent_workspaceId_type_idx" ON "Agent"("workspaceId", "type");
CREATE INDEX "Agent_workspaceId_status_idx" ON "Agent"("workspaceId", "status");
CREATE INDEX "Agent_currentVersionId_idx" ON "Agent"("currentVersionId");
CREATE UNIQUE INDEX "AgentVersion_agentId_version_key" ON "AgentVersion"("agentId", "version");
CREATE INDEX "AgentVersion_agentId_createdAt_idx" ON "AgentVersion"("agentId", "createdAt");
CREATE INDEX "AgentVersion_publishedByUserId_idx" ON "AgentVersion"("publishedByUserId");
CREATE UNIQUE INDEX "AgentExecution_workspaceId_agentId_sourceEntityType_sourceEntityId_key" ON "AgentExecution"("workspaceId", "agentId", "sourceEntityType", "sourceEntityId");
CREATE INDEX "AgentExecution_workspaceId_status_startedAt_idx" ON "AgentExecution"("workspaceId", "status", "startedAt");
CREATE INDEX "AgentExecution_agentId_startedAt_idx" ON "AgentExecution"("agentId", "startedAt");
CREATE INDEX "AgentExecution_versionId_idx" ON "AgentExecution"("versionId");
CREATE INDEX "AgentExecution_leadId_idx" ON "AgentExecution"("leadId");
CREATE INDEX "AgentExecution_correlationId_idx" ON "AgentExecution"("correlationId");

ALTER TABLE "Agent" ADD CONSTRAINT "Agent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "AgentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AgentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
