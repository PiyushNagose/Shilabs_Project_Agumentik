ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'LEAD_INTELLIGENCE_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'LEAD_AI_CONTROL_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'LEAD_DOCUMENT_INDEXED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'FOLLOW_UP_DECISION_RECORDED';

CREATE TYPE "LeadAiControlStatus" AS ENUM ('ON', 'OFF', 'PAUSED');
CREATE TYPE "LeadFollowUpMode" AS ENUM ('STANDARD', 'AGGRESSIVE', 'LOW_FREQUENCY', 'HIGH_VALUE', 'CUSTOM');
CREATE TYPE "LeadPreferredChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'PHONE', 'MIXED');
CREATE TYPE "LeadIntelligenceDecisionType" AS ENUM ('FOLLOW_UP', 'WAIT', 'ESCALATE', 'STOP', 'ASK_HUMAN');
CREATE TYPE "LeadDocumentKind" AS ENUM ('AUDIT', 'REPORT', 'PROPOSAL', 'PRICING', 'PRESENTATION', 'RESEARCH', 'OTHER');
CREATE TYPE "LeadDocumentSourceType" AS ENUM ('UPLOAD', 'LINK', 'CRM');
CREATE TYPE "LeadDocumentStatus" AS ENUM ('INDEXED', 'NEEDS_CONTENT', 'FAILED', 'ARCHIVED');

CREATE TABLE "LeadIntelligence" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "summary" TEXT,
  "primaryNeed" TEXT,
  "objections" TEXT[] NOT NULL,
  "commitments" TEXT[] NOT NULL,
  "nextObjective" TEXT,
  "communicationStyle" TEXT,
  "healthScore" INTEGER NOT NULL DEFAULT 0,
  "aiControlStatus" "LeadAiControlStatus" NOT NULL DEFAULT 'ON',
  "followUpMode" "LeadFollowUpMode" NOT NULL DEFAULT 'STANDARD',
  "humanInterventionRequired" BOOLEAN NOT NULL DEFAULT false,
  "preferredChannel" "LeadPreferredChannel" NOT NULL DEFAULT 'EMAIL',
  "customCadenceDays" INTEGER[] NOT NULL,
  "contextSnapshot" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "lastRefreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadIntelligence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadDocument" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "kind" "LeadDocumentKind" NOT NULL,
  "sourceType" "LeadDocumentSourceType" NOT NULL,
  "sourceUrl" TEXT,
  "mimeType" TEXT,
  "status" "LeadDocumentStatus" NOT NULL DEFAULT 'NEEDS_CONTENT',
  "extractedText" TEXT,
  "checksum" TEXT,
  "failureMessage" TEXT,
  "createdByUserId" TEXT,
  "indexedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadDocumentChunk" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadDocumentChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadIntelligenceDecision" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "decision" "LeadIntelligenceDecisionType" NOT NULL,
  "reason" TEXT NOT NULL,
  "nextObjective" TEXT,
  "factors" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "guardrailCode" TEXT,
  "correlationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadIntelligenceDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadIntelligence_leadId_key" ON "LeadIntelligence"("leadId");
CREATE INDEX "LeadIntelligence_workspaceId_aiControlStatus_idx" ON "LeadIntelligence"("workspaceId", "aiControlStatus");
CREATE INDEX "LeadIntelligence_workspaceId_healthScore_idx" ON "LeadIntelligence"("workspaceId", "healthScore");
CREATE INDEX "LeadIntelligence_lastRefreshedAt_idx" ON "LeadIntelligence"("lastRefreshedAt");
CREATE INDEX "LeadDocument_workspaceId_leadId_status_idx" ON "LeadDocument"("workspaceId", "leadId", "status");
CREATE INDEX "LeadDocument_leadId_kind_idx" ON "LeadDocument"("leadId", "kind");
CREATE INDEX "LeadDocument_checksum_idx" ON "LeadDocument"("checksum");
CREATE UNIQUE INDEX "LeadDocumentChunk_documentId_position_key" ON "LeadDocumentChunk"("documentId", "position");
CREATE INDEX "LeadDocumentChunk_workspaceId_leadId_idx" ON "LeadDocumentChunk"("workspaceId", "leadId");
CREATE INDEX "LeadIntelligenceDecision_workspaceId_decision_createdAt_idx" ON "LeadIntelligenceDecision"("workspaceId", "decision", "createdAt");
CREATE INDEX "LeadIntelligenceDecision_leadId_createdAt_idx" ON "LeadIntelligenceDecision"("leadId", "createdAt");
CREATE INDEX "LeadIntelligenceDecision_correlationId_idx" ON "LeadIntelligenceDecision"("correlationId");

ALTER TABLE "LeadIntelligence" ADD CONSTRAINT "LeadIntelligence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadIntelligence" ADD CONSTRAINT "LeadIntelligence_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDocument" ADD CONSTRAINT "LeadDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDocument" ADD CONSTRAINT "LeadDocument_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDocument" ADD CONSTRAINT "LeadDocument_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadDocumentChunk" ADD CONSTRAINT "LeadDocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LeadDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadIntelligenceDecision" ADD CONSTRAINT "LeadIntelligenceDecision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadIntelligenceDecision" ADD CONSTRAINT "LeadIntelligenceDecision_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
