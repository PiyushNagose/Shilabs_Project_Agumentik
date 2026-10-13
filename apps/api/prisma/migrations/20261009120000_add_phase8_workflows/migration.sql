CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');
CREATE TYPE "WorkflowExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'HUMAN_REQUIRED', 'SUCCEEDED', 'FAILED', 'CANCELED');
CREATE TYPE "WorkflowStepExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELED');

CREATE TABLE "Workflow" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "key" TEXT NOT NULL,
  "name" TEXT NOT NULL, "description" TEXT NOT NULL,
  "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
  "currentVersionId" TEXT, "draftVersionId" TEXT, "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkflowVersion" (
  "id" TEXT NOT NULL, "workflowId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "definition" JSONB NOT NULL, "policyConfig" JSONB,
  "publishedAt" TIMESTAMP(3), "publishedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkflowExecution" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "workflowId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL, "leadId" TEXT, "source" TEXT NOT NULL,
  "sourceEntityType" TEXT, "sourceEntityId" TEXT,
  "status" "WorkflowExecutionStatus" NOT NULL DEFAULT 'QUEUED', "currentNodeId" TEXT,
  "idempotencyKey" TEXT NOT NULL, "correlationId" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0, "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "input" JSONB, "result" JSONB, "failureCode" TEXT, "failureMessage" TEXT,
  "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkflowStepExecution" (
  "id" TEXT NOT NULL, "workflowExecutionId" TEXT NOT NULL, "nodeId" TEXT NOT NULL,
  "nodeType" TEXT NOT NULL, "status" "WorkflowStepExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 1, "idempotencyKey" TEXT NOT NULL,
  "input" JSONB, "output" JSONB, "failureCode" TEXT, "failureMessage" TEXT,
  "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "nextAttemptAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkflowStepExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workflow_workspaceId_key_key" ON "Workflow"("workspaceId", "key");
CREATE INDEX "Workflow_workspaceId_status_idx" ON "Workflow"("workspaceId", "status");
CREATE INDEX "Workflow_currentVersionId_idx" ON "Workflow"("currentVersionId");
CREATE INDEX "Workflow_draftVersionId_idx" ON "Workflow"("draftVersionId");
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");
CREATE INDEX "WorkflowVersion_workflowId_createdAt_idx" ON "WorkflowVersion"("workflowId", "createdAt");
CREATE INDEX "WorkflowVersion_publishedByUserId_idx" ON "WorkflowVersion"("publishedByUserId");
CREATE UNIQUE INDEX "WorkflowExecution_idempotencyKey_key" ON "WorkflowExecution"("idempotencyKey");
CREATE INDEX "WorkflowExecution_workspaceId_status_nextRunAt_idx" ON "WorkflowExecution"("workspaceId", "status", "nextRunAt");
CREATE INDEX "WorkflowExecution_workflowId_createdAt_idx" ON "WorkflowExecution"("workflowId", "createdAt");
CREATE INDEX "WorkflowExecution_versionId_idx" ON "WorkflowExecution"("versionId");
CREATE INDEX "WorkflowExecution_leadId_createdAt_idx" ON "WorkflowExecution"("leadId", "createdAt");
CREATE INDEX "WorkflowExecution_correlationId_idx" ON "WorkflowExecution"("correlationId");
CREATE UNIQUE INDEX "WorkflowStepExecution_idempotencyKey_key" ON "WorkflowStepExecution"("idempotencyKey");
CREATE INDEX "WorkflowStepExecution_workflowExecutionId_createdAt_idx" ON "WorkflowStepExecution"("workflowExecutionId", "createdAt");
CREATE INDEX "WorkflowStepExecution_status_nextAttemptAt_idx" ON "WorkflowStepExecution"("status", "nextAttemptAt");

ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "WorkflowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_draftVersionId_fkey" FOREIGN KEY ("draftVersionId") REFERENCES "WorkflowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "WorkflowVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkflowStepExecution" ADD CONSTRAINT "WorkflowStepExecution_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "WorkflowExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
