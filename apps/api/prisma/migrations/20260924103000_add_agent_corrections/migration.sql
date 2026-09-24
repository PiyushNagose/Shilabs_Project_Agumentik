-- R25 Agent Feedback/Correction Store

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'AGENT_CORRECTION_RECORDED';

CREATE TYPE "AgentCorrectionSourceType" AS ENUM (
  'PROPOSAL_GENERATION_RUN',
  'REPLY_PROCESSING_RUN'
);

CREATE TYPE "AgentCorrectionStatus" AS ENUM (
  'ACTIVE',
  'SUPERSEDED'
);

CREATE TABLE "AgentCorrection" (
  "id" TEXT NOT NULL,
  "agentModule" TEXT NOT NULL,
  "sourceEntityType" "AgentCorrectionSourceType" NOT NULL,
  "sourceEntityId" TEXT NOT NULL,
  "leadId" TEXT,
  "proposalId" TEXT,
  "conversationId" TEXT,
  "proposalGenerationRunId" TEXT,
  "replyProcessingRunId" TEXT,
  "previousOutput" JSONB NOT NULL,
  "correctedOutcome" JSONB NOT NULL,
  "correctionSummary" TEXT NOT NULL,
  "status" "AgentCorrectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "supersedesCorrectionId" TEXT,
  "correctedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentCorrection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentCorrection_agentModule_idx" ON "AgentCorrection"("agentModule");
CREATE INDEX "AgentCorrection_sourceEntityType_sourceEntityId_idx" ON "AgentCorrection"("sourceEntityType", "sourceEntityId");
CREATE INDEX "AgentCorrection_leadId_idx" ON "AgentCorrection"("leadId");
CREATE INDEX "AgentCorrection_proposalId_idx" ON "AgentCorrection"("proposalId");
CREATE INDEX "AgentCorrection_conversationId_idx" ON "AgentCorrection"("conversationId");
CREATE INDEX "AgentCorrection_proposalGenerationRunId_idx" ON "AgentCorrection"("proposalGenerationRunId");
CREATE INDEX "AgentCorrection_replyProcessingRunId_idx" ON "AgentCorrection"("replyProcessingRunId");
CREATE INDEX "AgentCorrection_status_idx" ON "AgentCorrection"("status");
CREATE INDEX "AgentCorrection_correctedByUserId_idx" ON "AgentCorrection"("correctedByUserId");
CREATE INDEX "AgentCorrection_createdAt_idx" ON "AgentCorrection"("createdAt");

ALTER TABLE "AgentCorrection" ADD CONSTRAINT "AgentCorrection_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentCorrection" ADD CONSTRAINT "AgentCorrection_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentCorrection" ADD CONSTRAINT "AgentCorrection_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentCorrection" ADD CONSTRAINT "AgentCorrection_proposalGenerationRunId_fkey" FOREIGN KEY ("proposalGenerationRunId") REFERENCES "ProposalGenerationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentCorrection" ADD CONSTRAINT "AgentCorrection_replyProcessingRunId_fkey" FOREIGN KEY ("replyProcessingRunId") REFERENCES "ReplyProcessingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentCorrection" ADD CONSTRAINT "AgentCorrection_supersedesCorrectionId_fkey" FOREIGN KEY ("supersedesCorrectionId") REFERENCES "AgentCorrection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentCorrection" ADD CONSTRAINT "AgentCorrection_correctedByUserId_fkey" FOREIGN KEY ("correctedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
