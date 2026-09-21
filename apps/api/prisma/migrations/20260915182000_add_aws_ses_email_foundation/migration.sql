ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'AWS_SES';

CREATE TYPE "OutboundEmailStatus" AS ENUM (
    'PENDING',
    'BLOCKED',
    'SENT',
    'DELIVERED',
    'BOUNCED',
    'COMPLAINED',
    'FAILED'
);

CREATE TYPE "EmailSuppressionReason" AS ENUM (
    'MANUAL',
    'BOUNCE',
    'COMPLAINT',
    'UNSUBSCRIBE',
    'PROVIDER'
);

CREATE TYPE "EmailProviderEventType" AS ENUM (
    'DELIVERY',
    'BOUNCE',
    'COMPLAINT'
);

CREATE TABLE "OutboundEmail" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "toEmail" TEXT NOT NULL,
    "normalizedToEmail" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "replyToEmail" TEXT,
    "subject" TEXT NOT NULL,
    "textBody" TEXT,
    "htmlBody" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "providerMessageId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "OutboundEmailStatus" NOT NULL DEFAULT 'PENDING',
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "complainedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutboundEmail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "reason" "EmailSuppressionReason" NOT NULL,
    "source" TEXT NOT NULL,
    "provider" "IntegrationProvider",
    "providerEventId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "outboundEmailId" TEXT,
    "type" "EmailProviderEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutboundEmail_providerMessageId_key" ON "OutboundEmail"("providerMessageId");
CREATE UNIQUE INDEX "OutboundEmail_idempotencyKey_key" ON "OutboundEmail"("idempotencyKey");
CREATE INDEX "OutboundEmail_leadId_idx" ON "OutboundEmail"("leadId");
CREATE INDEX "OutboundEmail_contactId_idx" ON "OutboundEmail"("contactId");
CREATE INDEX "OutboundEmail_actorUserId_idx" ON "OutboundEmail"("actorUserId");
CREATE INDEX "OutboundEmail_normalizedToEmail_idx" ON "OutboundEmail"("normalizedToEmail");
CREATE INDEX "OutboundEmail_provider_status_idx" ON "OutboundEmail"("provider", "status");
CREATE INDEX "OutboundEmail_createdAt_idx" ON "OutboundEmail"("createdAt");

CREATE UNIQUE INDEX "EmailSuppression_normalizedEmail_key" ON "EmailSuppression"("normalizedEmail");
CREATE INDEX "EmailSuppression_reason_idx" ON "EmailSuppression"("reason");
CREATE INDEX "EmailSuppression_provider_idx" ON "EmailSuppression"("provider");
CREATE INDEX "EmailSuppression_createdByUserId_idx" ON "EmailSuppression"("createdByUserId");
CREATE INDEX "EmailSuppression_createdAt_idx" ON "EmailSuppression"("createdAt");

CREATE UNIQUE INDEX "EmailProviderEvent_provider_providerEventId_key" ON "EmailProviderEvent"("provider", "providerEventId");
CREATE INDEX "EmailProviderEvent_provider_type_idx" ON "EmailProviderEvent"("provider", "type");
CREATE INDEX "EmailProviderEvent_providerMessageId_idx" ON "EmailProviderEvent"("providerMessageId");
CREATE INDEX "EmailProviderEvent_outboundEmailId_idx" ON "EmailProviderEvent"("outboundEmailId");
CREATE INDEX "EmailProviderEvent_receivedAt_idx" ON "EmailProviderEvent"("receivedAt");

ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailSuppression" ADD CONSTRAINT "EmailSuppression_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailProviderEvent" ADD CONSTRAINT "EmailProviderEvent_outboundEmailId_fkey" FOREIGN KEY ("outboundEmailId") REFERENCES "OutboundEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;
