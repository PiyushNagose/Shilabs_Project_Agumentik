import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type { DomainEventOutboxDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type { ListDomainEventsQuery } from "./domain-events.schemas.js";
import {
  claimNextDomainEvents,
  listDomainEventRecords,
  markDomainEventFailed as markFailed,
  markDomainEventProcessed as markProcessed,
  requestDomainEventRetry,
  type DomainEventRecord,
  type TransactionClient,
  upsertDomainEvent
} from "./domain-events.repository.js";

export interface PublishDomainEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
  correlationId?: string;
  idempotencyKey: string;
  priority?: "LOW" | "NORMAL" | "HIGH";
  maxAttempts?: number;
  nextAttemptAt?: Date;
  client?: TransactionClient;
}

export function toDomainEventDto(event: DomainEventRecord): DomainEventOutboxDto {
  return {
    id: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    status: event.status,
    priority: event.priority,
    correlationId: event.correlationId,
    idempotencyKey: event.idempotencyKey,
    attempts: event.attempts,
    maxAttempts: event.maxAttempts,
    nextAttemptAt: event.nextAttemptAt.toISOString(),
    queueName: event.queueName,
    queueJobId: event.queueJobId,
    queuedAt: event.queuedAt?.toISOString() ?? null,
    lockedAt: event.lockedAt?.toISOString() ?? null,
    lockedBy: event.lockedBy,
    processedAt: event.processedAt?.toISOString() ?? null,
    failedAt: event.failedAt?.toISOString() ?? null,
    deadLetteredAt: event.deadLetteredAt?.toISOString() ?? null,
    lastErrorCode: event.lastErrorCode,
    lastErrorMessage: event.lastErrorMessage,
    retryRequestedByUserId: event.retryRequestedByUserId,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString()
  };
}

export async function publishDomainEvent(
  input: PublishDomainEventInput
): Promise<DomainEventOutboxDto> {
  if (input.maxAttempts !== undefined && input.maxAttempts < 1) {
    throw new AppError(400, "VALIDATION_ERROR", "maxAttempts must be at least 1");
  }

  const event = await upsertDomainEvent({
    client: input.client,
    data: {
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      correlationId: input.correlationId ?? crypto.randomUUID(),
      idempotencyKey: input.idempotencyKey,
      priority: input.priority ?? "NORMAL",
      maxAttempts: input.maxAttempts ?? 5,
      nextAttemptAt: input.nextAttemptAt ?? new Date()
    }
  });
  return toDomainEventDto(event);
}

export async function listDomainEvents(
  query: ListDomainEventsQuery
): Promise<DomainEventOutboxDto[]> {
  const events = await listDomainEventRecords({
    where: {
      status: query.status,
      eventType: query.eventType,
      aggregateType: query.aggregateType,
      aggregateId: query.aggregateId
    },
    take: query.limit
  });
  return events.map(toDomainEventDto);
}

export async function claimDomainEvents(input: {
  workerId: string;
  limit: number;
}): Promise<DomainEventOutboxDto[]> {
  const events = await claimNextDomainEvents({
    workerId: input.workerId,
    limit: input.limit,
    now: new Date()
  });
  return events.map(toDomainEventDto);
}

export async function markDomainEventProcessed(id: string): Promise<DomainEventOutboxDto> {
  return toDomainEventDto(await markProcessed(id));
}

export async function markDomainEventFailed(input: {
  id: string;
  code: string;
  message: string;
  retryAt?: Date;
}): Promise<DomainEventOutboxDto> {
  return toDomainEventDto(await markFailed(input));
}

export async function retryDomainEvent(
  actor: AuthenticatedUser,
  id: string
): Promise<DomainEventOutboxDto> {
  return prisma.$transaction(async (tx) => {
    const event = await tx.domainEventOutbox.update({
      where: { id },
      data: {
        status: "PENDING",
        failedAt: null,
        lockedAt: null,
        lockedBy: null,
        retryRequestedByUserId: actor.id,
        nextAttemptAt: new Date()
      }
    });
    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        actorId: actor.id,
        entityType: "DomainEventOutbox",
        entityId: event.id,
        action: "DOMAIN_EVENT_RETRY_REQUESTED",
        after: { eventType: event.eventType, status: event.status }
      }
    });
    return toDomainEventDto(event);
  });
}

export { requestDomainEventRetry };
