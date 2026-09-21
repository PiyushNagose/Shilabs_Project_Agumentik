CREATE TYPE "DomainEventStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'PROCESSED',
    'FAILED'
);

CREATE TYPE "DomainEventPriority" AS ENUM (
    'LOW',
    'NORMAL',
    'HIGH'
);

CREATE TABLE "DomainEventOutbox" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DomainEventStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "DomainEventPriority" NOT NULL DEFAULT 'NORMAL',
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "retryRequestedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainEventOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DomainEventOutbox_idempotencyKey_key" ON "DomainEventOutbox"("idempotencyKey");
CREATE INDEX "DomainEventOutbox_eventType_idx" ON "DomainEventOutbox"("eventType");
CREATE INDEX "DomainEventOutbox_aggregateType_aggregateId_idx" ON "DomainEventOutbox"("aggregateType", "aggregateId");
CREATE INDEX "DomainEventOutbox_status_nextAttemptAt_idx" ON "DomainEventOutbox"("status", "nextAttemptAt");
CREATE INDEX "DomainEventOutbox_correlationId_idx" ON "DomainEventOutbox"("correlationId");
CREATE INDEX "DomainEventOutbox_priority_idx" ON "DomainEventOutbox"("priority");
CREATE INDEX "DomainEventOutbox_lockedAt_idx" ON "DomainEventOutbox"("lockedAt");
CREATE INDEX "DomainEventOutbox_processedAt_idx" ON "DomainEventOutbox"("processedAt");
CREATE INDEX "DomainEventOutbox_failedAt_idx" ON "DomainEventOutbox"("failedAt");
CREATE INDEX "DomainEventOutbox_retryRequestedByUserId_idx" ON "DomainEventOutbox"("retryRequestedByUserId");
CREATE INDEX "DomainEventOutbox_createdAt_idx" ON "DomainEventOutbox"("createdAt");

ALTER TABLE "DomainEventOutbox"
ADD CONSTRAINT "DomainEventOutbox_retryRequestedByUserId_fkey"
FOREIGN KEY ("retryRequestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
