ALTER TYPE "EmailSuppressionReason" ADD VALUE 'INVALID';

CREATE TYPE "EmailDeliverabilityScanStatus" AS ENUM (
    'COMPLETED',
    'PARTIAL',
    'FAILED'
);

CREATE TABLE "EmailDeliverabilityScan" (
    "id" TEXT NOT NULL,
    "status" "EmailDeliverabilityScanStatus" NOT NULL,
    "requestedByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "totalContacts" INTEGER NOT NULL DEFAULT 0,
    "eligibleContacts" INTEGER NOT NULL DEFAULT 0,
    "suppressedContacts" INTEGER NOT NULL DEFAULT 0,
    "invalidContacts" INTEGER NOT NULL DEFAULT 0,
    "doNotContactContacts" INTEGER NOT NULL DEFAULT 0,
    "terminalLeadContacts" INTEGER NOT NULL DEFAULT 0,
    "createdSuppressions" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDeliverabilityScan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailDeliverabilityScan_status_idx" ON "EmailDeliverabilityScan"("status");
CREATE INDEX "EmailDeliverabilityScan_requestedByUserId_idx" ON "EmailDeliverabilityScan"("requestedByUserId");
CREATE INDEX "EmailDeliverabilityScan_startedAt_idx" ON "EmailDeliverabilityScan"("startedAt");

ALTER TABLE "EmailDeliverabilityScan"
ADD CONSTRAINT "EmailDeliverabilityScan_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
