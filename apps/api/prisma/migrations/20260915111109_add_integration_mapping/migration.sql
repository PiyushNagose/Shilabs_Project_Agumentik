-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('ZOHO_BIGIN');

-- CreateEnum
CREATE TYPE "IntegrationAccountStatus" AS ENUM ('NOT_CONFIGURED', 'CONFIGURED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "ExternalRecordEntityType" AS ENUM ('COMPANY', 'CONTACT', 'LEAD', 'DEAL', 'PIPELINE_STAGE', 'ACTIVITY', 'MESSAGE', 'MEETING', 'PROPOSAL');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'CONFLICT');

-- CreateTable
CREATE TABLE "IntegrationAccount" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'default',
    "displayName" TEXT NOT NULL,
    "status" "IntegrationAccountStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "secretRef" TEXT,
    "publicConfig" JSONB,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalRecordMapping" (
    "id" TEXT NOT NULL,
    "integrationAccountId" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "entityType" "ExternalRecordEntityType" NOT NULL,
    "localEntityId" TEXT NOT NULL,
    "externalRecordId" TEXT NOT NULL,
    "externalVersion" TEXT,
    "externalUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncDirection" "SyncDirection" NOT NULL DEFAULT 'BIDIRECTIONAL',
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalRecordMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationAccount_provider_idx" ON "IntegrationAccount"("provider");

-- CreateIndex
CREATE INDEX "IntegrationAccount_status_idx" ON "IntegrationAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationAccount_provider_key_key" ON "IntegrationAccount"("provider", "key");

-- CreateIndex
CREATE INDEX "ExternalRecordMapping_integrationAccountId_idx" ON "ExternalRecordMapping"("integrationAccountId");

-- CreateIndex
CREATE INDEX "ExternalRecordMapping_provider_entityType_idx" ON "ExternalRecordMapping"("provider", "entityType");

-- CreateIndex
CREATE INDEX "ExternalRecordMapping_syncStatus_idx" ON "ExternalRecordMapping"("syncStatus");

-- CreateIndex
CREATE INDEX "ExternalRecordMapping_lastSyncedAt_idx" ON "ExternalRecordMapping"("lastSyncedAt");

-- CreateIndex
CREATE INDEX "ExternalRecordMapping_externalUpdatedAt_idx" ON "ExternalRecordMapping"("externalUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRecordMapping_provider_entityType_localEntityId_key" ON "ExternalRecordMapping"("provider", "entityType", "localEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRecordMapping_provider_entityType_externalRecordId_key" ON "ExternalRecordMapping"("provider", "entityType", "externalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRecordMapping_provider_idempotencyKey_key" ON "ExternalRecordMapping"("provider", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "ExternalRecordMapping" ADD CONSTRAINT "ExternalRecordMapping_integrationAccountId_fkey" FOREIGN KEY ("integrationAccountId") REFERENCES "IntegrationAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
