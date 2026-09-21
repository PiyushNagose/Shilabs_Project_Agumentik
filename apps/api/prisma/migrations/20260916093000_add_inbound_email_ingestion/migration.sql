ALTER TYPE "EmailProviderEventType" ADD VALUE IF NOT EXISTS 'INBOUND_RECEIVED';

CREATE TYPE "InboundEmailStatus" AS ENUM (
    'PROCESSED',
    'FAILED'
);

CREATE TYPE "ReplyProcessingStatus" AS ENUM (
    'PENDING',
    'PROCESSED',
    'FAILED',
    'SKIPPED'
);

CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "providerEventId" TEXT,
    "leadId" TEXT,
    "contactId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "normalizedFromEmail" TEXT NOT NULL,
    "toEmails" TEXT[],
    "subject" TEXT,
    "textBody" TEXT NOT NULL,
    "htmlBody" TEXT,
    "rawProviderPayload" JSONB NOT NULL,
    "status" "InboundEmailStatus" NOT NULL,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "replyProcessingStatus" "ReplyProcessingStatus",
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundEmail_providerMessageId_key" ON "InboundEmail"("providerMessageId");
CREATE UNIQUE INDEX "InboundEmail_messageId_key" ON "InboundEmail"("messageId");
CREATE UNIQUE INDEX "InboundEmail_provider_providerEventId_key" ON "InboundEmail"("provider", "providerEventId");
CREATE INDEX "InboundEmail_leadId_idx" ON "InboundEmail"("leadId");
CREATE INDEX "InboundEmail_contactId_idx" ON "InboundEmail"("contactId");
CREATE INDEX "InboundEmail_conversationId_idx" ON "InboundEmail"("conversationId");
CREATE INDEX "InboundEmail_normalizedFromEmail_idx" ON "InboundEmail"("normalizedFromEmail");
CREATE INDEX "InboundEmail_provider_status_idx" ON "InboundEmail"("provider", "status");
CREATE INDEX "InboundEmail_replyProcessingStatus_idx" ON "InboundEmail"("replyProcessingStatus");
CREATE INDEX "InboundEmail_receivedAt_idx" ON "InboundEmail"("receivedAt");

ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
