-- CreateTable
CREATE TABLE "LeadQualification" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "need" TEXT,
    "requirement" TEXT,
    "budget" TEXT,
    "budgetBand" TEXT,
    "authority" TEXT,
    "timeline" TEXT,
    "businessFit" TEXT,
    "decisionMakerIdentified" BOOLEAN,
    "urgency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadQualificationEvidence" (
    "id" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadQualificationEvidence_pkey" PRIMARY KEY ("id")
);

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'QUALIFICATION_UPDATED';

-- CreateIndex
CREATE UNIQUE INDEX "LeadQualification_leadId_key" ON "LeadQualification"("leadId");

-- CreateIndex
CREATE INDEX "LeadQualification_leadId_idx" ON "LeadQualification"("leadId");

-- CreateIndex
CREATE INDEX "LeadQualification_updatedAt_idx" ON "LeadQualification"("updatedAt");

-- CreateIndex
CREATE INDEX "LeadQualificationEvidence_qualificationId_idx" ON "LeadQualificationEvidence"("qualificationId");

-- CreateIndex
CREATE INDEX "LeadQualificationEvidence_messageId_idx" ON "LeadQualificationEvidence"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadQualificationEvidence_qualificationId_messageId_quote_key" ON "LeadQualificationEvidence"("qualificationId", "messageId", "quote");

-- AddForeignKey
ALTER TABLE "LeadQualification" ADD CONSTRAINT "LeadQualification_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadQualificationEvidence" ADD CONSTRAINT "LeadQualificationEvidence_qualificationId_fkey" FOREIGN KEY ("qualificationId") REFERENCES "LeadQualification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadQualificationEvidence" ADD CONSTRAINT "LeadQualificationEvidence_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
