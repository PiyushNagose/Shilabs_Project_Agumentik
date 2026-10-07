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
  retryDomainEvent,
  canPublishDomainEventRealtimeImmediately
} from "./domain-events.service.js";

const actorEmail = "r11-domain-events-admin@example.local";

async function cleanup(): Promise<void> {
  await prisma.auditEvent.deleteMany({ where: { entityType: "DomainEventOutbox" } });
  await prisma.domainEventOutbox.deleteMany({
    where: { idempotencyKey: { startsWith: "r11-domain-event:" } }
  });
  await prisma.authSession.deleteMany({ where: { user: { email: actorEmail } } });
  await prisma.lead.deleteMany({ where: { source: "r11-domain-event-test" } });
  await prisma.contact.deleteMany({ where: { source: "r11-domain-event-test" } });
  await prisma.company.deleteMany({ where: { name: "R11 Domain Event Company" } });
  await prisma.user.deleteMany({ where: { email: actorEmail } });
}

async function seedLead(): Promise<string> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const stage = await prisma.pipelineStage.upsert({
    where: { key: "NEW" },
    create: { workspaceId: workspace.id, key: "NEW", label: "New", order: 0, probability: 0 },
    update: { workspaceId: workspace.id }
  });
  const company = await prisma.company.create({
    data: { workspaceId: workspace.id, name: "R11 Domain Event Company" }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "R11",
      lastName: "Lead",
      source: "r11-domain-event-test"
    }
  });
  await prisma.lead.create({
    data: {
      id: "lead-r11",
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source: "r11-domain-event-test"
    }
  });
  return workspace.id;
}

async function seedActor(): Promise<AuthenticatedUser> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
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
  return { ...user, activeWorkspaceId: workspace.id };
}

describe("R11 domain event outbox", () => {
  beforeEach(async () => {
    await cleanup();
    await seedLead();
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

  it.each(["PENDING", "QUEUED", "PROCESSING", "PROCESSED"] as const)(
    "rejects an operator retry while an event is %s",
    async (status) => {
      const actor = await seedActor();
      const event = await publishDomainEvent({
        eventType: "REPLY_UNDERSTOOD",
        aggregateType: "ReplyProcessingRun",
        aggregateId: `run-r11-invalid-retry-${status}`,
        idempotencyKey: `r11-domain-event:invalid-retry:${status}`,
        payload: { leadId: "lead-r11" }
      });
      await prisma.domainEventOutbox.update({
        where: { id: event.id },
        data: { status }
      });

      await expect(retryDomainEvent(actor, event.id)).rejects.toMatchObject({
        statusCode: 409,
        code: "CONFLICT"
      });
    }
  );

  it("resets exhausted attempt and queue state only for an attention event", async () => {
    const actor = await seedActor();
    const event = await publishDomainEvent({
      eventType: "REPLY_UNDERSTOOD",
      aggregateType: "ReplyProcessingRun",
      aggregateId: "run-r11-attention-retry",
      idempotencyKey: "r11-domain-event:attention-retry",
      payload: { leadId: "lead-r11" }
    });
    await prisma.domainEventOutbox.update({
      where: { id: event.id },
      data: {
        status: "ATTENTION_REQUIRED",
        attempts: 5,
        queueName: "domain-events",
        queueJobId: "old-job",
        queuedAt: new Date(),
        deadLetteredAt: new Date(),
        lastErrorCode: "FAILED"
      }
    });

    await expect(retryDomainEvent(actor, event.id)).resolves.toMatchObject({
      status: "PENDING",
      attempts: 0,
      queueName: null,
      queueJobId: null,
      deadLetteredAt: null,
      lastErrorCode: null
    });
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

  it("defers realtime publication for events created inside a transaction", async () => {
    expect(canPublishDomainEventRealtimeImmediately(undefined)).toBe(true);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`;
      expect(canPublishDomainEventRealtimeImmediately(tx)).toBe(false);
    });
  });
});
