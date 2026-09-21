ALTER TYPE "DomainEventStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "DomainEventStatus" ADD VALUE IF NOT EXISTS 'ATTENTION_REQUIRED';

ALTER TABLE "DomainEventOutbox"
ADD COLUMN "queueName" TEXT,
ADD COLUMN "queueJobId" TEXT,
ADD COLUMN "queuedAt" TIMESTAMP(3),
ADD COLUMN "deadLetteredAt" TIMESTAMP(3);

CREATE INDEX "DomainEventOutbox_queueName_queueJobId_idx" ON "DomainEventOutbox"("queueName", "queueJobId");
CREATE INDEX "DomainEventOutbox_queuedAt_idx" ON "DomainEventOutbox"("queuedAt");
CREATE INDEX "DomainEventOutbox_deadLetteredAt_idx" ON "DomainEventOutbox"("deadLetteredAt");
