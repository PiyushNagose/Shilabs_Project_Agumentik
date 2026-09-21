-- CreateEnum
CREATE TYPE "ProposalZohoSyncStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SYNCED', 'FAILED', 'NOT_CONFIGURED');

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "zohoTimelineLastError" TEXT,
ADD COLUMN     "zohoTimelineSyncStatus" "ProposalZohoSyncStatus" NOT NULL DEFAULT 'NOT_REQUIRED';
