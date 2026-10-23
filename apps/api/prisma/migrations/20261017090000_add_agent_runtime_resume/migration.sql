ALTER TYPE "AgentExecutionStatus" ADD VALUE IF NOT EXISTS 'WAITING';
ALTER TYPE "AgentExecutionStatus" ADD VALUE IF NOT EXISTS 'HUMAN_REQUIRED';

ALTER TABLE "AgentExecution"
ADD COLUMN "currentNodeId" TEXT,
ADD COLUMN "nextRunAt" TIMESTAMP(3);

CREATE INDEX "AgentExecution_workspaceId_status_nextRunAt_idx"
ON "AgentExecution"("workspaceId", "status", "nextRunAt");
