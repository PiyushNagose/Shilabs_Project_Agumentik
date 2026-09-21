CREATE TYPE "ReplyIntent" AS ENUM (
    'INTERESTED',
    'NOT_INTERESTED',
    'PROPOSAL_REQUEST',
    'MEETING_REQUEST',
    'NEGOTIATION',
    'QUESTION',
    'UNCLEAR'
);

CREATE TYPE "ReplyRecommendedAction" AS ENUM (
    'DRAFT_RESPONSE',
    'STOP_AUTOMATION',
    'HUMAN_HANDOFF',
    'PROPOSAL_REVIEW',
    'MEETING_REVIEW',
    'NO_ACTION'
);

CREATE TYPE "ReplyProcessingRunStatus" AS ENUM (
    'COMPLETED',
    'FAILED',
    'SKIPPED'
);

CREATE TABLE "ReplyProcessingRun" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "inboundEmailId" TEXT,
    "status" "ReplyProcessingRunStatus" NOT NULL,
    "intent" "ReplyIntent",
    "recommendedAction" "ReplyRecommendedAction",
    "confidence" DECIMAL(3,2),
    "summary" TEXT,
    "draftResponse" TEXT,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT true,
    "humanHandoffRequired" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "model" TEXT,
    "inputContext" JSONB,
    "output" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyProcessingRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReplyProcessingRun_idempotencyKey_key" ON "ReplyProcessingRun"("idempotencyKey");
CREATE INDEX "ReplyProcessingRun_leadId_idx" ON "ReplyProcessingRun"("leadId");
CREATE INDEX "ReplyProcessingRun_conversationId_idx" ON "ReplyProcessingRun"("conversationId");
CREATE INDEX "ReplyProcessingRun_messageId_idx" ON "ReplyProcessingRun"("messageId");
CREATE INDEX "ReplyProcessingRun_inboundEmailId_idx" ON "ReplyProcessingRun"("inboundEmailId");
CREATE INDEX "ReplyProcessingRun_status_idx" ON "ReplyProcessingRun"("status");
CREATE INDEX "ReplyProcessingRun_intent_idx" ON "ReplyProcessingRun"("intent");
CREATE INDEX "ReplyProcessingRun_recommendedAction_idx" ON "ReplyProcessingRun"("recommendedAction");
CREATE INDEX "ReplyProcessingRun_createdAt_idx" ON "ReplyProcessingRun"("createdAt");

ALTER TABLE "ReplyProcessingRun"
ADD CONSTRAINT "ReplyProcessingRun_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReplyProcessingRun"
ADD CONSTRAINT "ReplyProcessingRun_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReplyProcessingRun"
ADD CONSTRAINT "ReplyProcessingRun_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReplyProcessingRun"
ADD CONSTRAINT "ReplyProcessingRun_inboundEmailId_fkey"
FOREIGN KEY ("inboundEmailId") REFERENCES "InboundEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;
