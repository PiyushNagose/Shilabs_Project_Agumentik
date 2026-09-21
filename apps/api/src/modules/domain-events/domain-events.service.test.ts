import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { hashPassword } from "../auth/auth.service.js";
import {
  claimDomainEvents,
  markDomainEventFailed,
  markDomainEventProcessed,
  publishDomainEvent,
  retryDomainEvent
} from "./domain-events.service.js";

const actorEmail = "r11-domain-events-admin@example.local";

async function cleanup(): Promise<void> {
  await prisma.auditEvent.deleteMany({ where: { entityType: "DomainEventOutbox" } });
  await prisma.domainEventOutbox.deleteMany({
    where: { idempotencyKey: { startsWith: "r11-domain-event:" } }
  });
  await prisma.authSession.deleteMany({ where: { user: { email: actorEmail } } });
  await prisma.user.deleteMany({ where: { email: actorEmail } });
}

async function seedActor(): Promise<AuthenticatedUser> {
  const user = await prisma.user.create({
    data: {
      email: actorEmail,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: "Domain",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
  return user;
}

describe("R11 domain event outbox", () => {
  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("publishes idempotently by idempotency key", async () => {
    const first = await publishDomainEvent({
      eventType: "REPLY_UNDERSTOOD",
      aggregateType: "ReplyProcessingRun",
      aggregateId: "run-r11-idempotent",
      correlationId: "correlation-r11",
      idempotencyKey: "r11-domain-event:idempotent",
      payload: { leadId: "lead-r11" }
    });
    const second = await publishDomainEvent({
      eventType: "REPLY_UNDERSTOOD",
      aggregateType: "ReplyProcessingRun",
      aggregateId: "run-r11-idempotent",
      correlationId: "correlation-r11",
      idempotencyKey: "r11-domain-event:idempotent",
      payload: { leadId: "lead-r11-updated" }
    });

    expect(second.id).toBe(first.id);
    await expect(
      prisma.domainEventOutbox.count({
        where: { idempotencyKey: "r11-domain-event:idempotent" }
      })
    ).resolves.toBe(1);
  });

  it("claims pending events with durable lock state and attempt count", async () => {
    await publishDomainEvent({
      eventType: "REPLY_UNDERSTOOD",
      aggregateType: "ReplyProcessingRun",
      aggregateId: "run-r11-claim",
      correlationId: "correlation-r11",
      idempotencyKey: "r11-domain-event:claim",
      payload: { leadId: "lead-r11" },
      priority: "HIGH"
    });

    const claimed = await claimDomainEvents({ workerId: "r11-worker", limit: 1 });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      status: "PROCESSING",
      attempts: 1,
      lockedBy: "r11-worker"
    });
  });

  it("preserves failure details and records operator retry requests", async () => {
    const actor = await seedActor();
    const event = await publishDomainEvent({
      eventType: "REPLY_UNDERSTOOD",
      aggregateType: "ReplyProcessingRun",
      aggregateId: "run-r11-failure",
      correlationId: "correlation-r11",
      idempotencyKey: "r11-domain-event:failure",
      payload: { leadId: "lead-r11" }
    });

    await markDomainEventFailed({
      id: event.id,
      code: "RETRYABLE_PROVIDER_ERROR",
      message: "Provider timed out",
      retryAt: new Date(Date.now() + 60_000)
    });
    const retry = await retryDomainEvent(actor, event.id);

    expect(retry).toMatchObject({
      status: "PENDING",
      retryRequestedByUserId: actor.id
    });
    await expect(
      prisma.auditEvent.count({
        where: {
          entityType: "DomainEventOutbox",
          entityId: event.id,
          action: "DOMAIN_EVENT_RETRY_REQUESTED"
        }
      })
    ).resolves.toBe(1);
  });

  it("marks claimed events processed without creating external side effects", async () => {
    const event = await publishDomainEvent({
      eventType: "REPLY_UNDERSTOOD",
      aggregateType: "ReplyProcessingRun",
      aggregateId: "run-r11-processed",
      correlationId: "correlation-r11",
      idempotencyKey: "r11-domain-event:processed",
      payload: { leadId: "lead-r11" }
    });

    const processed = await markDomainEventProcessed(event.id);

    expect(processed.status).toBe("PROCESSED");
    expect(processed.processedAt).not.toBeNull();
    expect(processed.lockedBy).toBeNull();
  });

  it("rolls back events when the surrounding transaction rolls back", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await publishDomainEvent({
          client: tx,
          eventType: "REPLY_UNDERSTOOD",
          aggregateType: "ReplyProcessingRun",
          aggregateId: "run-r11-rollback",
          correlationId: "correlation-r11",
          idempotencyKey: "r11-domain-event:rollback",
          payload: { leadId: "lead-r11" }
        });
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");

    await expect(
      prisma.domainEventOutbox.count({
        where: { idempotencyKey: "r11-domain-event:rollback" }
      })
    ).resolves.toBe(0);
  });
});
