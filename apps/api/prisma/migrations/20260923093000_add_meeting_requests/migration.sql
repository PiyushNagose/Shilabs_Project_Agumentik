-- R21 meeting orchestration state. Additive only; no destructive changes.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'MEETING_REQUESTED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'MEETING_CONFIRMED';

ALTER TYPE "InternalNotificationType" ADD VALUE IF NOT EXISTS 'MEETING_CONFIRMATION';

ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'GOOGLE_CALENDAR';

CREATE TYPE "MeetingRequestStatus" AS ENUM (
  'CONFIRMATION_REQUIRED',
  'PROVIDER_PENDING',
  'CONFIRMED',
  'ATTENTION_REQUIRED',
  'CANCELLED'
);

CREATE TYPE "MeetingSlotStatus" AS ENUM (
  'PROPOSED',
  'SELECTED',
  'EXPIRED'
);

CREATE TYPE "MeetingSyncStatus" AS ENUM (
  'NOT_REQUIRED',
  'PENDING',
  'SYNCED',
  'FAILED',
  'NOT_CONFIGURED'
);

CREATE TABLE "MeetingRequest" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "ownerId" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "confirmedByUserId" TEXT,
  "status" "MeetingRequestStatus" NOT NULL DEFAULT 'CONFIRMATION_REQUIRED',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "timeZone" TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "slotMinutes" INTEGER NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "selectedSlotId" TEXT,
  "provider" "IntegrationProvider" NOT NULL,
  "providerMeetingId" TEXT,
  "providerMeetingUrl" TEXT,
  "providerSyncStatus" "MeetingSyncStatus" NOT NULL DEFAULT 'PENDING',
  "providerLastError" TEXT,
  "zohoSyncStatus" "MeetingSyncStatus" NOT NULL DEFAULT 'PENDING',
  "zohoLastError" TEXT,
  "partyNotificationStatus" "MeetingSyncStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "partyNotificationNote" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeetingRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingSlot" (
  "id" TEXT NOT NULL,
  "meetingRequestId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "timeZone" TEXT NOT NULL,
  "status" "MeetingSlotStatus" NOT NULL DEFAULT 'PROPOSED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeetingSlot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InternalNotification" ADD COLUMN "meetingRequestId" TEXT;

CREATE UNIQUE INDEX "MeetingRequest_idempotencyKey_key" ON "MeetingRequest"("idempotencyKey");
CREATE INDEX "MeetingRequest_leadId_idx" ON "MeetingRequest"("leadId");
CREATE INDEX "MeetingRequest_contactId_idx" ON "MeetingRequest"("contactId");
CREATE INDEX "MeetingRequest_conversationId_idx" ON "MeetingRequest"("conversationId");
CREATE INDEX "MeetingRequest_ownerId_idx" ON "MeetingRequest"("ownerId");
CREATE INDEX "MeetingRequest_requestedByUserId_idx" ON "MeetingRequest"("requestedByUserId");
CREATE INDEX "MeetingRequest_confirmedByUserId_idx" ON "MeetingRequest"("confirmedByUserId");
CREATE INDEX "MeetingRequest_status_idx" ON "MeetingRequest"("status");
CREATE INDEX "MeetingRequest_provider_providerSyncStatus_idx" ON "MeetingRequest"("provider", "providerSyncStatus");
CREATE INDEX "MeetingRequest_zohoSyncStatus_idx" ON "MeetingRequest"("zohoSyncStatus");
CREATE INDEX "MeetingRequest_windowStart_idx" ON "MeetingRequest"("windowStart");
CREATE INDEX "MeetingRequest_confirmedAt_idx" ON "MeetingRequest"("confirmedAt");
CREATE INDEX "MeetingRequest_createdAt_idx" ON "MeetingRequest"("createdAt");

CREATE UNIQUE INDEX "MeetingSlot_meetingRequestId_startsAt_endsAt_key" ON "MeetingSlot"("meetingRequestId", "startsAt", "endsAt");
CREATE INDEX "MeetingSlot_meetingRequestId_idx" ON "MeetingSlot"("meetingRequestId");
CREATE INDEX "MeetingSlot_status_idx" ON "MeetingSlot"("status");
CREATE INDEX "MeetingSlot_startsAt_idx" ON "MeetingSlot"("startsAt");

CREATE INDEX "InternalNotification_meetingRequestId_idx" ON "InternalNotification"("meetingRequestId");

ALTER TABLE "MeetingRequest" ADD CONSTRAINT "MeetingRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeetingRequest" ADD CONSTRAINT "MeetingRequest_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeetingRequest" ADD CONSTRAINT "MeetingRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingRequest" ADD CONSTRAINT "MeetingRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingRequest" ADD CONSTRAINT "MeetingRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeetingRequest" ADD CONSTRAINT "MeetingRequest_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MeetingSlot" ADD CONSTRAINT "MeetingSlot_meetingRequestId_fkey" FOREIGN KEY ("meetingRequestId") REFERENCES "MeetingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InternalNotification" ADD CONSTRAINT "InternalNotification_meetingRequestId_fkey" FOREIGN KEY ("meetingRequestId") REFERENCES "MeetingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
