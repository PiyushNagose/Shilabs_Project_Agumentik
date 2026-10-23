ALTER TABLE "PrivacyCleanup" DROP CONSTRAINT "PrivacyCleanup_workspaceId_fkey";
ALTER TABLE "PrivacyCleanup" ADD CONSTRAINT "PrivacyCleanup_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspacePrivacyPolicy" DROP CONSTRAINT "WorkspacePrivacyPolicy_workspaceId_fkey";
ALTER TABLE "WorkspacePrivacyPolicy" ADD CONSTRAINT "WorkspacePrivacyPolicy_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
