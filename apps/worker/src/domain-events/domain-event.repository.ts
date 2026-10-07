import { Prisma, PrismaClient, type DomainEventOutbox } from "@prisma/client";

export const workerPrisma = new PrismaClient();

export type DomainEventRecord = DomainEventOutbox;

export async function expireExhaustedPendingDomainEvents(now: Date): Promise<number> {
  return workerPrisma.$executeRaw`
    UPDATE "DomainEventOutbox"
    SET
      status = 'ATTENTION_REQUIRED',
      "failedAt" = ${now},
      "deadLetteredAt" = ${now},
      "lastErrorCode" = 'MAX_ATTEMPTS_EXHAUSTED',
      "lastErrorMessage" = 'Domain event reached max attempts before processing',
      "updatedAt" = ${now}
    WHERE status = 'PENDING'
      AND "nextAttemptAt" <= ${now}
      AND attempts >= "maxAttempts"
  `;
}

export async function findDueDomainEvents(input: {
  now: Date;
  limit: number;
}): Promise<DomainEventRecord[]> {
  const candidates = await workerPrisma.domainEventOutbox.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: input.now }
    },
    orderBy: [{ priority: "desc" }, { nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: input.limit
  });
  return candidates;
}

export async function markDomainEventQueued(input: {
  eventId: string;
  queueName: string;
  queueJobId: string;
  now: Date;
}): Promise<boolean> {
  const result = await workerPrisma.domainEventOutbox.updateMany({
    where: { id: input.eventId, status: "PENDING" },
    data: {
      status: "QUEUED",
      queueName: input.queueName,
      queueJobId: input.queueJobId,
      queuedAt: input.now,
      lockedAt: null,
      lockedBy: null,
      failedAt: null,
      deadLetteredAt: null
    }
  });
  return result.count === 1;
}

export async function startDomainEventProcessing(input: {
  eventId: string;
  queueJobId: string;
  workerId: string;
  now: Date;
}): Promise<DomainEventRecord | null> {
  return workerPrisma.$transaction(async (tx) => {
    const event = await tx.domainEventOutbox.findUnique({ where: { id: input.eventId } });
    if (!event || event.status === "PROCESSED" || event.status === "ATTENTION_REQUIRED") {
      return null;
    }
    if (event.status !== "QUEUED" || event.queueJobId !== input.queueJobId) {
      return null;
    }
    if (event.attempts >= event.maxAttempts) {
      await tx.domainEventOutbox.update({
        where: { id: event.id },
        data: {
          status: "ATTENTION_REQUIRED",
          deadLetteredAt: input.now,
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: "MAX_ATTEMPTS_EXHAUSTED",
          lastErrorMessage: "Domain event reached max attempts before processing"
        }
      });
      return null;
    }

    return tx.domainEventOutbox.update({
      where: { id: event.id },
      data: {
        status: "PROCESSING",
        attempts: { increment: 1 },
        lockedAt: input.now,
        lockedBy: input.workerId
      }
    });
  });
}

export async function completeDomainEvent(input: {
  eventId: string;
  workerId: string;
  now: Date;
}): Promise<void> {
  await workerPrisma.domainEventOutbox.updateMany({
    where: { id: input.eventId, status: "PROCESSING", lockedBy: input.workerId },
    data: {
      status: "PROCESSED",
      processedAt: input.now,
      lockedAt: null,
      lockedBy: null,
      lastErrorCode: null,
      lastErrorMessage: null
    }
  });
}

export async function recordDomainEventFailure(input: {
  event: DomainEventRecord;
  code: string;
  message: string;
  retryAt: Date;
  now: Date;
  permanent: boolean;
}): Promise<"RETRY_SCHEDULED" | "ATTENTION_REQUIRED"> {
  const exhausted = input.permanent || input.event.attempts >= input.event.maxAttempts;
  await workerPrisma.domainEventOutbox.update({
    where: { id: input.event.id },
    data: exhausted
      ? {
          status: "ATTENTION_REQUIRED",
          deadLetteredAt: input.now,
          failedAt: input.now,
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: input.code,
          lastErrorMessage: input.message
        }
      : {
          status: "PENDING",
          nextAttemptAt: input.retryAt,
          failedAt: input.now,
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: input.code,
          lastErrorMessage: input.message
        }
  });
  return exhausted ? "ATTENTION_REQUIRED" : "RETRY_SCHEDULED";
}

export async function recoverStaleDomainEvents(input: {
  queuedStaleBefore: Date;
  processingStaleBefore: Date;
  now: Date;
  limit: number;
}): Promise<number> {
  const staleEvents = await workerPrisma.domainEventOutbox.findMany({
    where: {
      OR: [
        {
          status: "QUEUED",
          queuedAt: { lt: input.queuedStaleBefore },
          nextAttemptAt: { lte: input.now }
        },
        { status: "PROCESSING", lockedAt: { lt: input.processingStaleBefore } }
      ]
    },
    take: input.limit
  });

  let recovered = 0;
  for (const event of staleEvents) {
    const exhausted = event.attempts >= event.maxAttempts;
    await workerPrisma.domainEventOutbox.update({
      where: { id: event.id },
      data: exhausted
        ? {
            status: "ATTENTION_REQUIRED",
            deadLetteredAt: input.now,
            lockedAt: null,
            lockedBy: null,
            lastErrorCode: "STALE_WORK_EXHAUSTED",
            lastErrorMessage: "Stale queued/processing domain event exhausted retry attempts"
          }
        : {
            status: "PENDING",
            nextAttemptAt: input.now,
            lockedAt: null,
            lockedBy: null,
            queueJobId: null,
            queuedAt: null,
            lastErrorCode: "STALE_WORK_RECOVERED",
            lastErrorMessage: "Stale queued/processing domain event returned to pending"
          }
    });
    recovered += 1;
  }
  return recovered;
}

export async function getExecutionContext(input: { event: DomainEventRecord }): Promise<{
  lead?: {
    status: string;
    contact: { doNotContact: boolean; normalizedEmail: string | null };
  } | null;
  conversation?: { mode: string } | null;
  suppressedEmail?: boolean;
  activeHumanTakeover?: boolean;
}> {
  const payload = input.event.payload as Prisma.JsonObject;
  const leadId = typeof payload.leadId === "string" ? payload.leadId : null;
  const conversationId =
    typeof payload.conversationId === "string" ? payload.conversationId : null;

  const [lead, conversation] = await Promise.all([
    leadId
      ? workerPrisma.lead.findFirst({
          where: {
            id: leadId,
            workspaceId: input.event.workspaceId
          },
          select: {
            workspaceId: true,
            status: true,
            contact: { select: { doNotContact: true, normalizedEmail: true } }
          }
        })
      : Promise.resolve(null),
    conversationId
      ? workerPrisma.conversation.findFirst({
          where: {
            id: conversationId,
            workspaceId: input.event.workspaceId
          },
          select: { workspaceId: true, mode: true }
        })
      : Promise.resolve(null)
  ]);
  const normalizedEmail = lead?.contact.normalizedEmail;
  const suppression = normalizedEmail
    ? await workerPrisma.emailSuppression.findUnique({ where: { normalizedEmail } })
    : null;
  const activeTakeover =
    leadId || conversationId
      ? await workerPrisma.humanTakeover.findFirst({
          where: {
            status: "ACTIVE",
            lead: { workspaceId: input.event.workspaceId },
            OR: [
              ...(leadId ? [{ leadId }] : []),
              ...(conversationId ? [{ conversationId }] : [])
            ]
          },
          select: { id: true }
        })
      : null;

  return { lead, conversation, suppressedEmail: suppression !== null, activeHumanTakeover: activeTakeover !== null };
}
