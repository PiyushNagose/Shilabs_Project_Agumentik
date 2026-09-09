-- AlterTable
ALTER TABLE "Company" ADD COLUMN "normalizedWebsite" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Company_normalizedWebsite_key" ON "Company"("normalizedWebsite");

-- CreateIndex
CREATE INDEX "Company_normalizedWebsite_idx" ON "Company"("normalizedWebsite");
