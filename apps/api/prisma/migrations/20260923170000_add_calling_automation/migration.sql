-- CreateEnum
CREATE TYPE "CallingSequenceStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'STOPPED', 'ATTENTION_REQUIRED');

-- CreateEnum
CREATE TYPE "CallingAttemptStatus" AS ENUM ('SCHEDULED', 'CALLING', 'ACCEPTED', 'COMPLETED', 'BLOCKED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "CallingSequence" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "followUpSequenceId" TEXT,
    "status" "CallingSequenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "cadenceOffsets" INTEGER[],
    "currentAttempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "stopReason" TEXT,
    "stoppedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallingSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallingAttempt" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "attemptIndex" INTEGER NOT NULL,
    "status" "CallingAttemptStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "domainEventId" TEXT,
    "voiceCallAttemptId" TEXT,
    "activityId" TEXT,
    "zohoSyncStatus" "FollowUpZohoSyncStatus" NOT NULL DEFAULT 'PENDING',
    "zohoLastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallingSequence_idempotencyKey_key" ON "CallingSequence"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CallingSequence_leadId_idx" ON "CallingSequence"("leadId");

-- CreateIndex
CREATE INDEX "CallingSequence_contactId_idx" ON "CallingSequence"("contactId");

-- CreateIndex
CREATE INDEX "CallingSequence_followUpSequenceId_idx" ON "CallingSequence"("followUpSequenceId");

-- CreateIndex
CREATE INDEX "CallingSequence_status_idx" ON "CallingSequence"("status");

-- CreateIndex
CREATE INDEX "CallingSequence_createdAt_idx" ON "CallingSequence"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CallingAttempt_idempotencyKey_key" ON "CallingAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CallingAttempt_voiceCallAttemptId_key" ON "CallingAttempt"("voiceCallAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "CallingAttempt_sequenceId_attemptIndex_key" ON "CallingAttempt"("sequenceId", "attemptIndex");

-- CreateIndex
CREATE INDEX "CallingAttempt_leadId_idx" ON "CallingAttempt"("leadId");

-- CreateIndex
CREATE INDEX "CallingAttempt_contactId_idx" ON "CallingAttempt"("contactId");

-- CreateIndex
CREATE INDEX "CallingAttempt_status_scheduledAt_idx" ON "CallingAttempt"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "CallingAttempt_domainEventId_idx" ON "CallingAttempt"("domainEventId");

-- CreateIndex
CREATE INDEX "CallingAttempt_voiceCallAttemptId_idx" ON "CallingAttempt"("voiceCallAttemptId");

-- CreateIndex
CREATE INDEX "CallingAttempt_activityId_idx" ON "CallingAttempt"("activityId");

-- CreateIndex
CREATE INDEX "CallingAttempt_zohoSyncStatus_idx" ON "CallingAttempt"("zohoSyncStatus");

-- AddForeignKey
ALTER TABLE "CallingSequence" ADD CONSTRAINT "CallingSequence_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingSequence" ADD CONSTRAINT "CallingSequence_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingSequence" ADD CONSTRAINT "CallingSequence_followUpSequenceId_fkey" FOREIGN KEY ("followUpSequenceId") REFERENCES "FollowUpSequence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingAttempt" ADD CONSTRAINT "CallingAttempt_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "CallingSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingAttempt" ADD CONSTRAINT "CallingAttempt_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingAttempt" ADD CONSTRAINT "CallingAttempt_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingAttempt" ADD CONSTRAINT "CallingAttempt_voiceCallAttemptId_fkey" FOREIGN KEY ("voiceCallAttemptId") REFERENCES "VoiceCallAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
