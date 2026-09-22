-- CreateEnum
CREATE TYPE "HumanTakeoverStatus" AS ENUM ('ACTIVE');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'HUMAN_TAKEOVER';

-- CreateTable
CREATE TABLE "HumanTakeover" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "takenOverByUserId" TEXT NOT NULL,
    "status" "HumanTakeoverStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumanTakeover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HumanTakeover_conversationId_status_key" ON "HumanTakeover"("conversationId", "status");

-- CreateIndex
CREATE INDEX "HumanTakeover_leadId_idx" ON "HumanTakeover"("leadId");

-- CreateIndex
CREATE INDEX "HumanTakeover_conversationId_idx" ON "HumanTakeover"("conversationId");

-- CreateIndex
CREATE INDEX "HumanTakeover_takenOverByUserId_idx" ON "HumanTakeover"("takenOverByUserId");

-- CreateIndex
CREATE INDEX "HumanTakeover_status_idx" ON "HumanTakeover"("status");

-- CreateIndex
CREATE INDEX "HumanTakeover_createdAt_idx" ON "HumanTakeover"("createdAt");

-- AddForeignKey
ALTER TABLE "HumanTakeover" ADD CONSTRAINT "HumanTakeover_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanTakeover" ADD CONSTRAINT "HumanTakeover_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanTakeover" ADD CONSTRAINT "HumanTakeover_takenOverByUserId_fkey" FOREIGN KEY ("takenOverByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
