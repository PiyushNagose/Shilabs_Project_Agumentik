-- CreateEnum
CREATE TYPE "ProposalWorkflowStatus" AS ENUM ('DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'SENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'PROPOSAL_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'PROPOSAL_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE 'PROPOSAL_SUBMITTED';
ALTER TYPE "ActivityType" ADD VALUE 'PROPOSAL_APPROVED';
ALTER TYPE "ActivityType" ADD VALUE 'PROPOSAL_SENT';

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "dealId" TEXT,
    "title" TEXT NOT NULL,
    "serviceType" TEXT,
    "status" "ProposalWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "approvedVersionId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentByUserId" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentOutboundEmailId" TEXT,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalVersion" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "editSummary" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalStatusChange" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "fromStatus" "ProposalWorkflowStatus",
    "toStatus" "ProposalWorkflowStatus" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_sentOutboundEmailId_key" ON "Proposal"("sentOutboundEmailId");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_idempotencyKey_key" ON "Proposal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Proposal_leadId_idx" ON "Proposal"("leadId");

-- CreateIndex
CREATE INDEX "Proposal_dealId_idx" ON "Proposal"("dealId");

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");

-- CreateIndex
CREATE INDEX "Proposal_currentVersionId_idx" ON "Proposal"("currentVersionId");

-- CreateIndex
CREATE INDEX "Proposal_approvedVersionId_idx" ON "Proposal"("approvedVersionId");

-- CreateIndex
CREATE INDEX "Proposal_approvedByUserId_idx" ON "Proposal"("approvedByUserId");

-- CreateIndex
CREATE INDEX "Proposal_sentByUserId_idx" ON "Proposal"("sentByUserId");

-- CreateIndex
CREATE INDEX "Proposal_createdByUserId_idx" ON "Proposal"("createdByUserId");

-- CreateIndex
CREATE INDEX "Proposal_createdAt_idx" ON "Proposal"("createdAt");

-- CreateIndex
CREATE INDEX "Proposal_updatedAt_idx" ON "Proposal"("updatedAt");

-- CreateIndex
CREATE INDEX "ProposalVersion_proposalId_idx" ON "ProposalVersion"("proposalId");

-- CreateIndex
CREATE INDEX "ProposalVersion_createdByUserId_idx" ON "ProposalVersion"("createdByUserId");

-- CreateIndex
CREATE INDEX "ProposalVersion_createdAt_idx" ON "ProposalVersion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalVersion_proposalId_version_key" ON "ProposalVersion"("proposalId", "version");

-- CreateIndex
CREATE INDEX "ProposalStatusChange_proposalId_idx" ON "ProposalStatusChange"("proposalId");

-- CreateIndex
CREATE INDEX "ProposalStatusChange_actorUserId_idx" ON "ProposalStatusChange"("actorUserId");

-- CreateIndex
CREATE INDEX "ProposalStatusChange_toStatus_idx" ON "ProposalStatusChange"("toStatus");

-- CreateIndex
CREATE INDEX "ProposalStatusChange_createdAt_idx" ON "ProposalStatusChange"("createdAt");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ProposalVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_approvedVersionId_fkey" FOREIGN KEY ("approvedVersionId") REFERENCES "ProposalVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_sentOutboundEmailId_fkey" FOREIGN KEY ("sentOutboundEmailId") REFERENCES "OutboundEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalStatusChange" ADD CONSTRAINT "ProposalStatusChange_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalStatusChange" ADD CONSTRAINT "ProposalStatusChange_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
