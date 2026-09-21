-- M5: Track proposal lifecycle on manually managed deals.
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED');

ALTER TABLE "Deal" ADD COLUMN "proposalStatus" "ProposalStatus";
