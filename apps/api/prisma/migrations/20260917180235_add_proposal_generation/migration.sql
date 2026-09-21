-- CreateEnum
CREATE TYPE "ProposalGenerationKind" AS ENUM ('GENERAL', 'SEO', 'WEB_DESIGN');

-- CreateEnum
CREATE TYPE "ProposalGenerationStatus" AS ENUM ('COMPLETED', 'NEEDS_INPUT', 'FAILED');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'PROPOSAL_GENERATED';

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'SEMRUSH';

-- CreateTable
CREATE TABLE "ProposalGenerationRun" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "dealId" TEXT,
    "proposalId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "kind" "ProposalGenerationKind" NOT NULL,
    "status" "ProposalGenerationStatus" NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "inputContext" JSONB NOT NULL,
    "approvedKnowledge" JSONB,
    "toolEvidence" JSONB,
    "aiOutput" JSONB,
    "missingFields" TEXT[],
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalGenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProposalGenerationRun_idempotencyKey_key" ON "ProposalGenerationRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProposalGenerationRun_leadId_idx" ON "ProposalGenerationRun"("leadId");

-- CreateIndex
CREATE INDEX "ProposalGenerationRun_dealId_idx" ON "ProposalGenerationRun"("dealId");

-- CreateIndex
CREATE INDEX "ProposalGenerationRun_proposalId_idx" ON "ProposalGenerationRun"("proposalId");

-- CreateIndex
CREATE INDEX "ProposalGenerationRun_actorUserId_idx" ON "ProposalGenerationRun"("actorUserId");

-- CreateIndex
CREATE INDEX "ProposalGenerationRun_kind_idx" ON "ProposalGenerationRun"("kind");

-- CreateIndex
CREATE INDEX "ProposalGenerationRun_status_idx" ON "ProposalGenerationRun"("status");

-- CreateIndex
CREATE INDEX "ProposalGenerationRun_createdAt_idx" ON "ProposalGenerationRun"("createdAt");

-- AddForeignKey
ALTER TABLE "ProposalGenerationRun" ADD CONSTRAINT "ProposalGenerationRun_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalGenerationRun" ADD CONSTRAINT "ProposalGenerationRun_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalGenerationRun" ADD CONSTRAINT "ProposalGenerationRun_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalGenerationRun" ADD CONSTRAINT "ProposalGenerationRun_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
