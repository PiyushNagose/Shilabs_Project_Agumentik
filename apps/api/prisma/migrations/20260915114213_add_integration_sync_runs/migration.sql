-- CreateEnum
CREATE TYPE "IntegrationSyncRunStatus" AS ENUM ('COMPLETED', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "IntegrationSyncRun" (
    "id" TEXT NOT NULL,
    "integrationAccountId" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "operation" TEXT NOT NULL,
    "status" "IntegrationSyncRunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "requestedByUserId" TEXT,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "succeededRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "skippedRecords" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_integrationAccountId_idx" ON "IntegrationSyncRun"("integrationAccountId");

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_provider_operation_idx" ON "IntegrationSyncRun"("provider", "operation");

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_status_idx" ON "IntegrationSyncRun"("status");

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_startedAt_idx" ON "IntegrationSyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_requestedByUserId_idx" ON "IntegrationSyncRun"("requestedByUserId");

-- AddForeignKey
ALTER TABLE "IntegrationSyncRun" ADD CONSTRAINT "IntegrationSyncRun_integrationAccountId_fkey" FOREIGN KEY ("integrationAccountId") REFERENCES "IntegrationAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSyncRun" ADD CONSTRAINT "IntegrationSyncRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
