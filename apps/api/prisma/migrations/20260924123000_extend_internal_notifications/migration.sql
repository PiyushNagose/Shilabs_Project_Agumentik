-- CreateEnum
CREATE TYPE "InternalNotificationEscalationStatus" AS ENUM ('NONE', 'PENDING', 'ESCALATED');

-- AlterEnum
ALTER TYPE "InternalNotificationStatus" ADD VALUE 'ACKNOWLEDGED';
ALTER TYPE "InternalNotificationStatus" ADD VALUE 'ESCALATED';

-- AlterTable
ALTER TABLE "InternalNotification"
ADD COLUMN "escalationStatus" "InternalNotificationEscalationStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "readByUserId" TEXT,
ADD COLUMN "acknowledgedByUserId" TEXT,
ADD COLUMN "escalatedByUserId" TEXT,
ADD COLUMN "readAt" TIMESTAMP(3),
ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN "escalatedAt" TIMESTAMP(3),
ADD COLUMN "escalationDueAt" TIMESTAMP(3),
ADD COLUMN "escalationReason" TEXT,
ADD COLUMN "escalationEvidence" JSONB;

-- CreateIndex
CREATE INDEX "InternalNotification_escalationStatus_idx" ON "InternalNotification"("escalationStatus");

-- CreateIndex
CREATE INDEX "InternalNotification_readByUserId_idx" ON "InternalNotification"("readByUserId");

-- CreateIndex
CREATE INDEX "InternalNotification_acknowledgedByUserId_idx" ON "InternalNotification"("acknowledgedByUserId");

-- CreateIndex
CREATE INDEX "InternalNotification_escalatedByUserId_idx" ON "InternalNotification"("escalatedByUserId");

-- CreateIndex
CREATE INDEX "InternalNotification_escalationDueAt_idx" ON "InternalNotification"("escalationDueAt");

-- AddForeignKey
ALTER TABLE "InternalNotification" ADD CONSTRAINT "InternalNotification_readByUserId_fkey" FOREIGN KEY ("readByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNotification" ADD CONSTRAINT "InternalNotification_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNotification" ADD CONSTRAINT "InternalNotification_escalatedByUserId_fkey" FOREIGN KEY ("escalatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
