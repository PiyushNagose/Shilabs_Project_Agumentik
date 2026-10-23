ALTER TABLE "OutboundEmail"
  ADD COLUMN "ccEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "attachmentMetadata" JSONB,
  ADD COLUMN "threadId" TEXT,
  ADD COLUMN "inReplyTo" TEXT,
  ADD COLUMN "providerReferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "senderType" "MessageSenderType" NOT NULL DEFAULT 'USER',
  ADD COLUMN "deliveryStatus" "MessageDeliveryStatus" NOT NULL DEFAULT 'PENDING';

ALTER TABLE "InboundEmail"
  ADD COLUMN "ccEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "attachmentMetadata" JSONB,
  ADD COLUMN "threadId" TEXT,
  ADD COLUMN "inReplyTo" TEXT,
  ADD COLUMN "providerReferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "senderType" "MessageSenderType" NOT NULL DEFAULT 'PROSPECT',
  ADD COLUMN "deliveryStatus" "MessageDeliveryStatus" NOT NULL DEFAULT 'DELIVERED';

ALTER TABLE "OutboundWhatsAppMessage"
  ADD COLUMN "messageType" TEXT NOT NULL DEFAULT 'template',
  ADD COLUMN "mediaMetadata" JSONB,
  ADD COLUMN "replyToProviderMessageId" TEXT,
  ADD COLUMN "senderType" "MessageSenderType" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "deliveryStatus" "MessageDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "providerStatus" TEXT;

ALTER TABLE "Message"
  ADD COLUMN "attachmentMetadata" JSONB,
  ADD COLUMN "providerThreadId" TEXT,
  ADD COLUMN "providerReferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "OutboundEmail_threadId_idx" ON "OutboundEmail"("threadId");
CREATE INDEX "InboundEmail_threadId_idx" ON "InboundEmail"("threadId");
CREATE INDEX "OutboundWhatsAppMessage_replyToProviderMessageId_idx"
  ON "OutboundWhatsAppMessage"("replyToProviderMessageId");
