ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'CALL_CONVERSATION_COMPLETED';
ALTER TYPE "VoiceProviderEventType" ADD VALUE IF NOT EXISTS 'VOICE_STREAM';

CREATE TYPE "VoiceConversationRunStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

CREATE TABLE "VoiceConversationRun" (
    "id" TEXT NOT NULL,
    "voiceCallAttemptId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "replyProcessingRunId" TEXT,
    "status" "VoiceConversationRunStatus" NOT NULL DEFAULT 'STARTED',
    "provider" TEXT,
    "model" TEXT,
    "transcriptText" TEXT,
    "outcome" JSONB,
    "intent" "ReplyIntent",
    "recommendedAction" "ReplyRecommendedAction",
    "summary" TEXT,
    "humanHandoffRequired" BOOLEAN NOT NULL DEFAULT false,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceConversationRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceConversationRun_voiceCallAttemptId_key" ON "VoiceConversationRun"("voiceCallAttemptId");
CREATE UNIQUE INDEX "VoiceConversationRun_replyProcessingRunId_key" ON "VoiceConversationRun"("replyProcessingRunId");
CREATE UNIQUE INDEX "VoiceConversationRun_idempotencyKey_key" ON "VoiceConversationRun"("idempotencyKey");
CREATE INDEX "VoiceConversationRun_leadId_idx" ON "VoiceConversationRun"("leadId");
CREATE INDEX "VoiceConversationRun_conversationId_idx" ON "VoiceConversationRun"("conversationId");
CREATE INDEX "VoiceConversationRun_messageId_idx" ON "VoiceConversationRun"("messageId");
CREATE INDEX "VoiceConversationRun_replyProcessingRunId_idx" ON "VoiceConversationRun"("replyProcessingRunId");
CREATE INDEX "VoiceConversationRun_status_idx" ON "VoiceConversationRun"("status");
CREATE INDEX "VoiceConversationRun_intent_idx" ON "VoiceConversationRun"("intent");
CREATE INDEX "VoiceConversationRun_startedAt_idx" ON "VoiceConversationRun"("startedAt");
CREATE INDEX "VoiceConversationRun_completedAt_idx" ON "VoiceConversationRun"("completedAt");

ALTER TABLE "VoiceConversationRun"
ADD CONSTRAINT "VoiceConversationRun_voiceCallAttemptId_fkey"
FOREIGN KEY ("voiceCallAttemptId") REFERENCES "VoiceCallAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoiceConversationRun"
ADD CONSTRAINT "VoiceConversationRun_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VoiceConversationRun"
ADD CONSTRAINT "VoiceConversationRun_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VoiceConversationRun"
ADD CONSTRAINT "VoiceConversationRun_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VoiceConversationRun"
ADD CONSTRAINT "VoiceConversationRun_replyProcessingRunId_fkey"
FOREIGN KEY ("replyProcessingRunId") REFERENCES "ReplyProcessingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
