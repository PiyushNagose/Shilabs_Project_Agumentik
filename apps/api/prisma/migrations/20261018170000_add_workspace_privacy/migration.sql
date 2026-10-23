ALTER TABLE "Contact" ADD COLUMN "erasedAt" TIMESTAMP(3);
CREATE TABLE "WorkspacePrivacyPolicy" (
  "workspaceId" TEXT PRIMARY KEY REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "periods" JSONB NOT NULL DEFAULT '{}',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PrivacyCleanup" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "policyRevision" INTEGER NOT NULL,
  "plan" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "appliedAt" TIMESTAMP(3)
);
CREATE INDEX "PrivacyCleanup_workspaceId_expiresAt_idx" ON "PrivacyCleanup"("workspaceId", "expiresAt");
