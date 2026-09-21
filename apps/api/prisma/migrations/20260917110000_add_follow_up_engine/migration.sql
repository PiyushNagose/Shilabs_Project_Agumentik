CREATE TYPE "FollowUpSequenceStatus" AS ENUM (
    'ACTIVE',
    'STOPPED',
    'COMPLETED',
    'ATTENTION_REQUIRED'
);

CREATE TYPE "FollowUpAttemptStatus" AS ENUM (
    'SCHEDULED',
    'SENDING',
    'SENT',
    'BLOCKED',
    'FAILED',
    'CANCELLED',
    'SKIPPED'
);

CREATE TYPE "FollowUpAttemptKind" AS ENUM (
    'FIRST_EMAIL',
    'FOLLOW_UP'
);

CREATE TYPE "FollowUpZohoSyncStatus" AS ENUM (
    'NOT_REQUIRED',
    'PENDING',
    'SYNCED',
    'FAILED'
);

CREATE TABLE "FollowUpSequence" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "status" "FollowUpSequenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "cadenceDays" INTEGER[],
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "stopReason" TEXT,
    "stoppedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpSequence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FollowUpAttempt" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "kind" "FollowUpAttemptKind" NOT NULL,
    "status" "FollowUpAttemptStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "subject" TEXT NOT NULL,
    "textBody" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "domainEventId" TEXT,
    "outboundEmailId" TEXT,
    "zohoSyncStatus" "FollowUpZohoSyncStatus" NOT NULL DEFAULT 'PENDING',
    "zohoLastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FollowUpSequence_idempotencyKey_key" ON "FollowUpSequence"("idempotencyKey");
CREATE INDEX "FollowUpSequence_leadId_idx" ON "FollowUpSequence"("leadId");
CREATE INDEX "FollowUpSequence_contactId_idx" ON "FollowUpSequence"("contactId");
CREATE INDEX "FollowUpSequence_conversationId_idx" ON "FollowUpSequence"("conversationId");
CREATE INDEX "FollowUpSequence_status_idx" ON "FollowUpSequence"("status");
CREATE INDEX "FollowUpSequence_createdAt_idx" ON "FollowUpSequence"("createdAt");

CREATE UNIQUE INDEX "FollowUpAttempt_idempotencyKey_key" ON "FollowUpAttempt"("idempotencyKey");
CREATE UNIQUE INDEX "FollowUpAttempt_sequenceId_stepIndex_key" ON "FollowUpAttempt"("sequenceId", "stepIndex");
CREATE INDEX "FollowUpAttempt_leadId_idx" ON "FollowUpAttempt"("leadId");
CREATE INDEX "FollowUpAttempt_status_scheduledAt_idx" ON "FollowUpAttempt"("status", "scheduledAt");
CREATE INDEX "FollowUpAttempt_domainEventId_idx" ON "FollowUpAttempt"("domainEventId");
CREATE INDEX "FollowUpAttempt_outboundEmailId_idx" ON "FollowUpAttempt"("outboundEmailId");
CREATE INDEX "FollowUpAttempt_zohoSyncStatus_idx" ON "FollowUpAttempt"("zohoSyncStatus");

ALTER TABLE "FollowUpSequence"
ADD CONSTRAINT "FollowUpSequence_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FollowUpSequence"
ADD CONSTRAINT "FollowUpSequence_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FollowUpSequence"
ADD CONSTRAINT "FollowUpSequence_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FollowUpAttempt"
ADD CONSTRAINT "FollowUpAttempt_sequenceId_fkey"
FOREIGN KEY ("sequenceId") REFERENCES "FollowUpSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FollowUpAttempt"
ADD CONSTRAINT "FollowUpAttempt_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FollowUpAttempt"
ADD CONSTRAINT "FollowUpAttempt_outboundEmailId_fkey"
FOREIGN KEY ("outboundEmailId") REFERENCES "OutboundEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;
