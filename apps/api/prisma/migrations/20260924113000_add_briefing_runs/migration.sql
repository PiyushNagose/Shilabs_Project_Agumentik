-- CreateEnum
CREATE TYPE "BriefingKind" AS ENUM ('LEAD', 'MEETING');

-- CreateEnum
CREATE TYPE "BriefingRunStatus" AS ENUM ('COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'BRIEFING_GENERATED';

-- CreateTable
CREATE TABLE "BriefingRun" (
    "id" TEXT NOT NULL,
    "kind" "BriefingKind" NOT NULL,
    "leadId" TEXT NOT NULL,
    "meetingRequestId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "status" "BriefingRunStatus" NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "inputContext" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "approvedKnowledge" JSONB,
    "output" JSONB,
    "summary" TEXT,
    "recommendedNextAction" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BriefingRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BriefingRun_idempotencyKey_key" ON "BriefingRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BriefingRun_kind_idx" ON "BriefingRun"("kind");

-- CreateIndex
CREATE INDEX "BriefingRun_leadId_idx" ON "BriefingRun"("leadId");

-- CreateIndex
CREATE INDEX "BriefingRun_meetingRequestId_idx" ON "BriefingRun"("meetingRequestId");

-- CreateIndex
CREATE INDEX "BriefingRun_actorUserId_idx" ON "BriefingRun"("actorUserId");

-- CreateIndex
CREATE INDEX "BriefingRun_status_idx" ON "BriefingRun"("status");

-- CreateIndex
CREATE INDEX "BriefingRun_createdAt_idx" ON "BriefingRun"("createdAt");

-- AddForeignKey
ALTER TABLE "BriefingRun" ADD CONSTRAINT "BriefingRun_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingRun" ADD CONSTRAINT "BriefingRun_meetingRequestId_fkey" FOREIGN KEY ("meetingRequestId") REFERENCES "MeetingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingRun" ADD CONSTRAINT "BriefingRun_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
