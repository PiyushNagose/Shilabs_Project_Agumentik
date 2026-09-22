-- CreateEnum
CREATE TYPE "NegotiationHandoffStatus" AS ENUM ('ACTIVE', 'ATTENTION_REQUIRED');

-- CreateEnum
CREATE TYPE "InternalNotificationType" AS ENUM ('NEGOTIATION_HANDOFF');

-- CreateEnum
CREATE TYPE "InternalNotificationStatus" AS ENUM ('UNREAD', 'READ', 'ATTENTION_REQUIRED');

-- CreateEnum
CREATE TYPE "InternalNotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'NEGOTIATION_HANDOFF';

-- CreateTable
CREATE TABLE "NegotiationHandoff" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "replyProcessingRunId" TEXT NOT NULL,
    "assignedOwnerId" TEXT,
    "status" "NegotiationHandoffStatus" NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT NOT NULL,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NegotiationHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalNotification" (
    "id" TEXT NOT NULL,
    "type" "InternalNotificationType" NOT NULL,
    "status" "InternalNotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "severity" "InternalNotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "leadId" TEXT,
    "conversationId" TEXT,
    "negotiationHandoffId" TEXT,
    "sourceEntityType" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NegotiationHandoff_replyProcessingRunId_key" ON "NegotiationHandoff"("replyProcessingRunId");

-- CreateIndex
CREATE UNIQUE INDEX "NegotiationHandoff_idempotencyKey_key" ON "NegotiationHandoff"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NegotiationHandoff_leadId_idx" ON "NegotiationHandoff"("leadId");

-- CreateIndex
CREATE INDEX "NegotiationHandoff_conversationId_idx" ON "NegotiationHandoff"("conversationId");

-- CreateIndex
CREATE INDEX "NegotiationHandoff_assignedOwnerId_idx" ON "NegotiationHandoff"("assignedOwnerId");

-- CreateIndex
CREATE INDEX "NegotiationHandoff_status_idx" ON "NegotiationHandoff"("status");

-- CreateIndex
CREATE INDEX "NegotiationHandoff_createdAt_idx" ON "NegotiationHandoff"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InternalNotification_idempotencyKey_key" ON "InternalNotification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InternalNotification_type_idx" ON "InternalNotification"("type");

-- CreateIndex
CREATE INDEX "InternalNotification_status_idx" ON "InternalNotification"("status");

-- CreateIndex
CREATE INDEX "InternalNotification_severity_idx" ON "InternalNotification"("severity");

-- CreateIndex
CREATE INDEX "InternalNotification_assignedToUserId_idx" ON "InternalNotification"("assignedToUserId");

-- CreateIndex
CREATE INDEX "InternalNotification_leadId_idx" ON "InternalNotification"("leadId");

-- CreateIndex
CREATE INDEX "InternalNotification_conversationId_idx" ON "InternalNotification"("conversationId");

-- CreateIndex
CREATE INDEX "InternalNotification_negotiationHandoffId_idx" ON "InternalNotification"("negotiationHandoffId");

-- CreateIndex
CREATE INDEX "InternalNotification_sourceEntityType_sourceEntityId_idx" ON "InternalNotification"("sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE INDEX "InternalNotification_createdAt_idx" ON "InternalNotification"("createdAt");

-- AddForeignKey
ALTER TABLE "NegotiationHandoff" ADD CONSTRAINT "NegotiationHandoff_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationHandoff" ADD CONSTRAINT "NegotiationHandoff_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationHandoff" ADD CONSTRAINT "NegotiationHandoff_replyProcessingRunId_fkey" FOREIGN KEY ("replyProcessingRunId") REFERENCES "ReplyProcessingRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationHandoff" ADD CONSTRAINT "NegotiationHandoff_assignedOwnerId_fkey" FOREIGN KEY ("assignedOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNotification" ADD CONSTRAINT "InternalNotification_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNotification" ADD CONSTRAINT "InternalNotification_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNotification" ADD CONSTRAINT "InternalNotification_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNotification" ADD CONSTRAINT "InternalNotification_negotiationHandoffId_fkey" FOREIGN KEY ("negotiationHandoffId") REFERENCES "NegotiationHandoff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
