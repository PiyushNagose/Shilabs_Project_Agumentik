-- R22 voice provider foundation. Additive only; no destructive changes.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'CALL_REQUESTED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'CALL_STATUS_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'CALL_FAILED';

ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'TWILIO';
ALTER TYPE "ExternalRecordEntityType" ADD VALUE IF NOT EXISTS 'CALL';

CREATE TYPE "VoiceCallDirection" AS ENUM ('OUTBOUND');

CREATE TYPE "VoiceCallStatus" AS ENUM (
  'REQUESTED',
  'PROVIDER_PENDING',
  'QUEUED',
  'RINGING',
  'IN_PROGRESS',
  'COMPLETED',
  'BUSY',
  'NO_ANSWER',
  'FAILED',
  'CANCELED',
  'BLOCKED',
  'NOT_CONFIGURED'
);

CREATE TYPE "VoiceRecordingStatus" AS ENUM (
  'DISABLED',
  'PENDING',
  'AVAILABLE',
  'FAILED'
);

CREATE TYPE "VoiceTranscriptStatus" AS ENUM (
  'DISABLED',
  'PENDING',
  'AVAILABLE',
  'FAILED'
);

CREATE TYPE "VoiceProviderEventType" AS ENUM (
  'CALL_STATUS',
  'RECORDING_STATUS'
);

CREATE TABLE "VoiceCallAttempt" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "provider" "IntegrationProvider" NOT NULL,
  "direction" "VoiceCallDirection" NOT NULL DEFAULT 'OUTBOUND',
  "toPhone" TEXT NOT NULL,
  "normalizedToPhone" TEXT NOT NULL,
  "fromPhone" TEXT NOT NULL,
  "providerCallId" TEXT,
  "status" "VoiceCallStatus" NOT NULL DEFAULT 'REQUESTED',
  "regionalVoice" TEXT,
  "accent" TEXT,
  "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "transcriptionEnabled" BOOLEAN NOT NULL DEFAULT false,
  "recordingStatus" "VoiceRecordingStatus" NOT NULL DEFAULT 'DISABLED',
  "recordingProviderId" TEXT,
  "recordingUrl" TEXT,
  "transcriptStatus" "VoiceTranscriptStatus" NOT NULL DEFAULT 'DISABLED',
  "transcriptProviderId" TEXT,
  "transcriptUrl" TEXT,
  "transcriptText" TEXT,
  "durationSeconds" INTEGER,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "providerAcceptedAt" TIMESTAMP(3),
  "answeredAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VoiceCallAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VoiceProviderEvent" (
  "id" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "providerCallId" TEXT,
  "callAttemptId" TEXT,
  "type" "VoiceProviderEventType" NOT NULL,
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VoiceProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceCallAttempt_providerCallId_key" ON "VoiceCallAttempt"("providerCallId");
CREATE UNIQUE INDEX "VoiceCallAttempt_idempotencyKey_key" ON "VoiceCallAttempt"("idempotencyKey");
CREATE INDEX "VoiceCallAttempt_leadId_idx" ON "VoiceCallAttempt"("leadId");
CREATE INDEX "VoiceCallAttempt_contactId_idx" ON "VoiceCallAttempt"("contactId");
CREATE INDEX "VoiceCallAttempt_actorUserId_idx" ON "VoiceCallAttempt"("actorUserId");
CREATE INDEX "VoiceCallAttempt_provider_status_idx" ON "VoiceCallAttempt"("provider", "status");
CREATE INDEX "VoiceCallAttempt_providerCallId_idx" ON "VoiceCallAttempt"("providerCallId");
CREATE INDEX "VoiceCallAttempt_normalizedToPhone_idx" ON "VoiceCallAttempt"("normalizedToPhone");
CREATE INDEX "VoiceCallAttempt_requestedAt_idx" ON "VoiceCallAttempt"("requestedAt");
CREATE INDEX "VoiceCallAttempt_completedAt_idx" ON "VoiceCallAttempt"("completedAt");

CREATE UNIQUE INDEX "VoiceProviderEvent_provider_providerEventId_key" ON "VoiceProviderEvent"("provider", "providerEventId");
CREATE INDEX "VoiceProviderEvent_provider_type_idx" ON "VoiceProviderEvent"("provider", "type");
CREATE INDEX "VoiceProviderEvent_providerCallId_idx" ON "VoiceProviderEvent"("providerCallId");
CREATE INDEX "VoiceProviderEvent_callAttemptId_idx" ON "VoiceProviderEvent"("callAttemptId");
CREATE INDEX "VoiceProviderEvent_receivedAt_idx" ON "VoiceProviderEvent"("receivedAt");

ALTER TABLE "VoiceCallAttempt" ADD CONSTRAINT "VoiceCallAttempt_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoiceCallAttempt" ADD CONSTRAINT "VoiceCallAttempt_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoiceCallAttempt" ADD CONSTRAINT "VoiceCallAttempt_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VoiceProviderEvent" ADD CONSTRAINT "VoiceProviderEvent_callAttemptId_fkey" FOREIGN KEY ("callAttemptId") REFERENCES "VoiceCallAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
