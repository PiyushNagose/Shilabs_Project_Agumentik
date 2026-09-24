-- R24 WhatsApp Integration

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'WHATSAPP_SENT';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'WHATSAPP_STATUS_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'WHATSAPP_RECEIVED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'WHATSAPP_FAILED';

ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'META_WHATSAPP';
ALTER TYPE "ExternalRecordEntityType" ADD VALUE IF NOT EXISTS 'WHATSAPP_MESSAGE';

CREATE TYPE "OutboundWhatsAppStatus" AS ENUM (
  'PENDING',
  'PROVIDER_PENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'BLOCKED',
  'NOT_CONFIGURED'
);

CREATE TYPE "WhatsAppProviderEventType" AS ENUM (
  'MESSAGE_STATUS',
  'INBOUND_MESSAGE',
  'WEBHOOK_VERIFICATION'
);

CREATE TABLE "OutboundWhatsAppMessage" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "callingAttemptId" TEXT,
  "conversationId" TEXT,
  "provider" "IntegrationProvider" NOT NULL,
  "toWhatsAppId" TEXT NOT NULL,
  "normalizedToPhone" TEXT,
  "fromPhoneNumberId" TEXT,
  "templateName" TEXT,
  "templateLanguage" TEXT,
  "textBody" TEXT,
  "providerMessageId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "status" "OutboundWhatsAppStatus" NOT NULL DEFAULT 'PENDING',
  "zohoSyncStatus" "FollowUpZohoSyncStatus" NOT NULL DEFAULT 'PENDING',
  "zohoLastError" TEXT,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutboundWhatsAppMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppProviderEvent" (
  "id" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "outboundMessageId" TEXT,
  "type" "WhatsAppProviderEventType" NOT NULL,
  "payload" JSONB NOT NULL,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutboundWhatsAppMessage_providerMessageId_key" ON "OutboundWhatsAppMessage"("providerMessageId");
CREATE UNIQUE INDEX "OutboundWhatsAppMessage_idempotencyKey_key" ON "OutboundWhatsAppMessage"("idempotencyKey");
CREATE INDEX "OutboundWhatsAppMessage_leadId_idx" ON "OutboundWhatsAppMessage"("leadId");
CREATE INDEX "OutboundWhatsAppMessage_contactId_idx" ON "OutboundWhatsAppMessage"("contactId");
CREATE INDEX "OutboundWhatsAppMessage_callingAttemptId_idx" ON "OutboundWhatsAppMessage"("callingAttemptId");
CREATE INDEX "OutboundWhatsAppMessage_conversationId_idx" ON "OutboundWhatsAppMessage"("conversationId");
CREATE INDEX "OutboundWhatsAppMessage_provider_status_idx" ON "OutboundWhatsAppMessage"("provider", "status");
CREATE INDEX "OutboundWhatsAppMessage_providerMessageId_idx" ON "OutboundWhatsAppMessage"("providerMessageId");
CREATE INDEX "OutboundWhatsAppMessage_zohoSyncStatus_idx" ON "OutboundWhatsAppMessage"("zohoSyncStatus");
CREATE INDEX "OutboundWhatsAppMessage_createdAt_idx" ON "OutboundWhatsAppMessage"("createdAt");

CREATE UNIQUE INDEX "WhatsAppProviderEvent_provider_providerEventId_key" ON "WhatsAppProviderEvent"("provider", "providerEventId");
CREATE INDEX "WhatsAppProviderEvent_provider_type_idx" ON "WhatsAppProviderEvent"("provider", "type");
CREATE INDEX "WhatsAppProviderEvent_providerMessageId_idx" ON "WhatsAppProviderEvent"("providerMessageId");
CREATE INDEX "WhatsAppProviderEvent_outboundMessageId_idx" ON "WhatsAppProviderEvent"("outboundMessageId");
CREATE INDEX "WhatsAppProviderEvent_receivedAt_idx" ON "WhatsAppProviderEvent"("receivedAt");

ALTER TABLE "OutboundWhatsAppMessage" ADD CONSTRAINT "OutboundWhatsAppMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutboundWhatsAppMessage" ADD CONSTRAINT "OutboundWhatsAppMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutboundWhatsAppMessage" ADD CONSTRAINT "OutboundWhatsAppMessage_callingAttemptId_fkey" FOREIGN KEY ("callingAttemptId") REFERENCES "CallingAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OutboundWhatsAppMessage" ADD CONSTRAINT "OutboundWhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhatsAppProviderEvent" ADD CONSTRAINT "WhatsAppProviderEvent_outboundMessageId_fkey" FOREIGN KEY ("outboundMessageId") REFERENCES "OutboundWhatsAppMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
