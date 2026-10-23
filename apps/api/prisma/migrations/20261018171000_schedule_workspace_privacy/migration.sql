ALTER TABLE "WorkspacePrivacyPolicy" ADD COLUMN "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "WorkspacePrivacyPolicy_enabled_nextRunAt_idx" ON "WorkspacePrivacyPolicy"("enabled", "nextRunAt");
