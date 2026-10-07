-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES_REP', 'OPERATIONS', 'VIEWER');

-- CreateEnum
CREATE TYPE "WorkspaceMemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "CallingSequence" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "DomainEventOutbox" ADD COLUMN     "workspaceId" TEXT;

ALTER TABLE "VoiceCallAttempt" ADD COLUMN     "workspaceId" TEXT;
ALTER TABLE "VoiceProviderEvent" ADD COLUMN     "workspaceId" TEXT;
ALTER TABLE "WhatsAppProviderEvent" ADD COLUMN     "workspaceId" TEXT;
ALTER TABLE "OutboundEmail" ADD COLUMN     "workspaceId" TEXT;
ALTER TABLE "EmailProviderEvent" ADD COLUMN     "workspaceId" TEXT;
ALTER TABLE "InboundEmail" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "ExternalRecordMapping" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "FollowUpSequence" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "IntegrationAccount" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "IntegrationSyncRun" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "InternalNotification" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "MeetingRequest" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "OutboundWhatsAppMessage" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "PipelineStage" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "status" "WorkspaceMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_status_idx" ON "Workspace"("status");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_status_idx" ON "WorkspaceMember"("userId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_role_status_idx" ON "WorkspaceMember"("workspaceId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- Deterministic compatibility bootstrap. Existing rows are assigned to one
-- workspace without requiring manual edits; the seed remains rerunnable.
INSERT INTO "Workspace" ("id", "name", "slug", "status", "createdAt", "updatedAt")
VALUES ('workspace_default', 'Default Workspace', 'default', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "status", "joinedAt", "createdAt", "updatedAt")
SELECT 'member_' || md5(u."id"), 'workspace_default', u."id",
  CASE u."role"::text
    WHEN 'ADMIN' THEN 'ADMIN'::"WorkspaceRole"
    WHEN 'SALES_MANAGER' THEN 'SALES_MANAGER'::"WorkspaceRole"
    WHEN 'SALES_REP' THEN 'SALES_REP'::"WorkspaceRole"
    ELSE 'VIEWER'::"WorkspaceRole"
  END,
  'ACTIVE'::"WorkspaceMemberStatus", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
ON CONFLICT ("workspaceId", "userId") DO UPDATE SET "status" = 'ACTIVE'::"WorkspaceMemberStatus";

UPDATE "Activity" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "AuditEvent" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "CallingSequence" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "Company" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "Contact" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "Conversation" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "Deal" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "DomainEventOutbox" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "VoiceCallAttempt" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "VoiceProviderEvent" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "WhatsAppProviderEvent" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "OutboundEmail" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "EmailProviderEvent" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "InboundEmail" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "ExternalRecordMapping" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "FollowUpSequence" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "IntegrationAccount" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "IntegrationSyncRun" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "InternalNotification" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "Lead" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "MeetingRequest" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "Message" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "OutboundWhatsAppMessage" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "PipelineStage" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;
UPDATE "Proposal" SET "workspaceId" = 'workspace_default' WHERE "workspaceId" IS NULL;

DROP INDEX "IntegrationAccount_provider_key_key";
DROP INDEX "ExternalRecordMapping_provider_entityType_localEntityId_key";
DROP INDEX "ExternalRecordMapping_provider_entityType_externalRecordId_key";
DROP INDEX "ExternalRecordMapping_provider_idempotencyKey_key";
CREATE UNIQUE INDEX "IntegrationAccount_workspaceId_provider_key_key" ON "IntegrationAccount"("workspaceId", "provider", "key");
CREATE UNIQUE INDEX "ExternalRecordMapping_workspaceId_provider_entityType_localEntityId_key" ON "ExternalRecordMapping"("workspaceId", "provider", "entityType", "localEntityId");
CREATE UNIQUE INDEX "ExternalRecordMapping_workspaceId_provider_entityType_externalRecordId_key" ON "ExternalRecordMapping"("workspaceId", "provider", "entityType", "externalRecordId");
CREATE UNIQUE INDEX "ExternalRecordMapping_workspaceId_provider_idempotencyKey_key" ON "ExternalRecordMapping"("workspaceId", "provider", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_createdAt_idx" ON "Activity"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Company_workspaceId_name_idx" ON "Company"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_companyId_idx" ON "Contact"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_leadId_idx" ON "Conversation"("workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "InternalNotification_workspaceId_createdAt_idx" ON "InternalNotification"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_ownerId_idx" ON "Lead"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "MeetingRequest_workspaceId_leadId_idx" ON "MeetingRequest"("workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "PipelineStage_workspaceId_order_idx" ON "PipelineStage"("workspaceId", "order");

CREATE INDEX "VoiceCallAttempt_workspaceId_leadId_idx" ON "VoiceCallAttempt"("workspaceId", "leadId");
CREATE INDEX "VoiceProviderEvent_workspaceId_receivedAt_idx" ON "VoiceProviderEvent"("workspaceId", "receivedAt");
CREATE INDEX "WhatsAppProviderEvent_workspaceId_receivedAt_idx" ON "WhatsAppProviderEvent"("workspaceId", "receivedAt");
CREATE INDEX "OutboundEmail_workspaceId_leadId_idx" ON "OutboundEmail"("workspaceId", "leadId");
CREATE INDEX "EmailProviderEvent_workspaceId_receivedAt_idx" ON "EmailProviderEvent"("workspaceId", "receivedAt");
CREATE INDEX "InboundEmail_workspaceId_receivedAt_idx" ON "InboundEmail"("workspaceId", "receivedAt");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
