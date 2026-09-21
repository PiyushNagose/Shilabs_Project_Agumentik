import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

export type DomainEventRecord = Prisma.DomainEventOutboxGetPayload<Record<string, never>>;

export type TransactionClient = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export async function upsertDomainEvent(input: {
  client?: TransactionClient;
  data: Prisma.DomainEventOutboxCreateInput;
}): Promise<DomainEventRecord> {
  const client = input.client ?? prisma;
  return client.domainEventOutbox.upsert({
    where: { idempotencyKey: input.data.idempotencyKey },
    create: input.data,
    update: {}
  });
}

export async function listDomainEventRecords(input: {
  where: Prisma.DomainEventOutboxWhereInput;
  take: number;
}): Promise<DomainEventRecord[]> {
  return prisma.domainEventOutbox.findMany({
    where: input.where,
    orderBy: [{ priority: "desc" }, { nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: input.take
  });
}

export async function claimNextDomainEvents(input: {
  workerId: string;
  limit: number;
  now: Date;
}): Promise<DomainEventRecord[]> {
  return prisma.$transaction(async (tx) => {
    const candidates = (
      await tx.domainEventOutbox.findMany({
      where: {
        status: "PENDING",
        nextAttemptAt: { lte: input.now },
        lockedAt: null
      },
      orderBy: [{ priority: "desc" }, { nextAttemptAt: "asc" }, { createdAt: "asc" }],
        take: input.limit * 2
      })
    )
      .filter((event) => event.attempts < event.maxAttempts)
      .slice(0, input.limit);
    const claimed: DomainEventRecord[] = [];
    for (const candidate of candidates) {
      const updated = await tx.domainEventOutbox.updateMany({
        where: { id: candidate.id, status: "PENDING", lockedAt: null },
        data: {
          status: "PROCESSING",
          lockedAt: input.now,
          lockedBy: input.workerId,
          attempts: { increment: 1 }
        }
      });
      if (updated.count === 1) {
        claimed.push(await tx.domainEventOutbox.findUniqueOrThrow({ where: { id: candidate.id } }));
      }
    }
    return claimed;
  });
}

export async function markDomainEventProcessed(id: string): Promise<DomainEventRecord> {
  return prisma.domainEventOutbox.update({
    where: { id },
    data: {
      status: "PROCESSED",
      processedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastErrorCode: null,
      lastErrorMessage: null
    }
  });
}

export async function markDomainEventFailed(input: {
  id: string;
  code: string;
  message: string;
  retryAt?: Date;
}): Promise<DomainEventRecord> {
  return prisma.domainEventOutbox.update({
    where: { id: input.id },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
      nextAttemptAt: input.retryAt
    }
  });
}

export async function requestDomainEventRetry(input: {
  id: string;
  actorId: string;
}): Promise<DomainEventRecord> {
  return prisma.domainEventOutbox.update({
    where: { id: input.id },
    data: {
      status: "PENDING",
      failedAt: null,
      lockedAt: null,
      lockedBy: null,
      retryRequestedByUserId: input.actorId,
      nextAttemptAt: new Date()
    }
  });
}
