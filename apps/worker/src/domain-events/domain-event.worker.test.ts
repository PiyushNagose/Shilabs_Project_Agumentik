import { afterAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { dispatchDueDomainEvents, type DomainEventQueueLike } from "./domain-event.dispatcher.js";
import { processDomainEventJob } from "./domain-event.processor.js";
import { workerPrisma } from "./domain-event.repository.js";

class FakeQueue implements DomainEventQueueLike {
  public readonly name = "domain-events";
  public readonly added: { name: string; data: unknown; jobId: string }[] = [];

  public add: DomainEventQueueLike["add"] = (name, data, options) => {
    this.added.push({ name, data, jobId: options.jobId });
    return Promise.resolve();
  };
}

async function cleanup(): Promise<void> {
  await workerPrisma.domainEventOutbox.deleteMany({
    where: { idempotencyKey: { startsWith: "r12-domain-event:" } }
  });
  await workerPrisma.emailSuppression.deleteMany({
    where: { normalizedEmail: { startsWith: "r12-" } }
  });
  await workerPrisma.humanTakeover.deleteMany({
    where: { lead: { source: "r12-worker-test" } }
  });
  await workerPrisma.conversation.deleteMany({ where: { lead: { source: "r12-worker-test" } } });
  await workerPrisma.lead.deleteMany({ where: { source: "r12-worker-test" } });
  await workerPrisma.contact.deleteMany({ where: { source: "r12-worker-test" } });
  await workerPrisma.company.deleteMany({ where: { name: { startsWith: "R12 " } } });
  await workerPrisma.user.deleteMany({ where: { email: "r12-worker-owner@example.local" } });
}

async function createEvent(input?: {
  eventType?: string;
  payload?: Prisma.InputJsonValue;
  attempts?: number;
  maxAttempts?: number;
}) {
  return workerPrisma.domainEventOutbox.create({
    data: {
      eventType: input?.eventType ?? "REPLY_UNDERSTOOD",
      aggregateType: "ReplyProcessingRun",
      aggregateId: `r12-run-${crypto.randomUUID()}`,
      payload: input?.payload ?? { leadId: "r12-lead" },
      correlationId: `r12-correlation-${crypto.randomUUID()}`,
      idempotencyKey: `r12-domain-event:${crypto.randomUUID()}`,
      attempts: input?.attempts ?? 0,
      maxAttempts: input?.maxAttempts ?? 5,
      nextAttemptAt: new Date(Date.now() - 1000)
    }
  });
}

async function createBlockedLeadFixture() {
  const stage = await workerPrisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await workerPrisma.company.create({ data: { name: `R12 Company ${crypto.randomUUID()}` } });
  const contact = await workerPrisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "R12",
      lastName: "Blocked",
      email: "r12-blocked@example.com",
      normalizedEmail: "r12-blocked@example.com",
      source: "r12-worker-test",
      doNotContact: true
    }
  });
  const lead = await workerPrisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source: "r12-worker-test",
      status: "OPEN"
    }
  });
  const conversation = await workerPrisma.conversation.create({
    data: { leadId: lead.id, channel: "EMAIL", mode: "AUTO" }
  });
  return { lead, conversation };
}

describe("R12 domain event worker", () => {
  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await workerPrisma.$disconnect();
  }, 45000);

  it("dispatches due outbox events to a deduped queue job and marks them queued", async () => {
    const event = await createEvent();
    const queue = new FakeQueue();

    const result = await dispatchDueDomainEvents({ queue, limit: 10, now: new Date() });

    expect(result.dispatched).toBeGreaterThanOrEqual(1);
    expect(queue.added.some((job) => job.jobId === event.id)).toBe(true);
    await expect(workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } }))
      .resolves.toMatchObject({ status: "QUEUED", queueJobId: event.id });
  });

  it("processes internal events and records completion only after processing", async () => {
    const event = await createEvent();
    const queue = new FakeQueue();
    await dispatchDueDomainEvents({ queue, limit: 10, now: new Date() });

    const result = await processDomainEventJob({
      eventId: event.id,
      queueJobId: event.id,
      workerId: "r12-worker"
    });

    expect(result).toBe("PROCESSED");
    await expect(workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } }))
      .resolves.toMatchObject({ status: "PROCESSED", attempts: 1, lockedBy: null });
  });

  it("moves unsupported events to attention instead of fake success", async () => {
    const event = await createEvent({ eventType: "UNSUPPORTED_EXTERNAL_ACTION" });
    const queue = new FakeQueue();
    await dispatchDueDomainEvents({ queue, limit: 10, now: new Date() });

    await expect(
      processDomainEventJob({ eventId: event.id, queueJobId: event.id, workerId: "r12-worker" })
    ).rejects.toThrow("No worker handler");

    await expect(workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } }))
      .resolves.toMatchObject({
        status: "ATTENTION_REQUIRED",
        lastErrorCode: "UNSUPPORTED_DOMAIN_EVENT"
      });
  });

  it("revalidates communication eligibility at execution time", async () => {
    const { lead, conversation } = await createBlockedLeadFixture();
    const event = await createEvent({
      eventType: "EMAIL_SEND_REQUESTED",
      payload: { leadId: lead.id, conversationId: conversation.id }
    });
    const queue = new FakeQueue();
    await dispatchDueDomainEvents({ queue, limit: 10, now: new Date() });

    await expect(
      processDomainEventJob({ eventId: event.id, queueJobId: event.id, workerId: "r12-worker" })
    ).rejects.toThrow("doNotContact");

    await expect(workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } }))
      .resolves.toMatchObject({ status: "ATTENTION_REQUIRED", lastErrorCode: "DO_NOT_CONTACT" });
  });

  it("blocks communication events when human takeover is active", async () => {
    const { lead, conversation } = await createBlockedLeadFixture();
    await workerPrisma.contact.update({
      where: { id: lead.contactId },
      data: { doNotContact: false }
    });
    const user = await workerPrisma.user.create({
      data: {
        email: "r12-worker-owner@example.local",
        passwordHash: "test-hash",
        firstName: "Worker",
        lastName: "Owner",
        role: "SALES_REP",
        status: "ACTIVE"
      }
    });
    await workerPrisma.humanTakeover.create({
      data: {
        leadId: lead.id,
        conversationId: conversation.id,
        takenOverByUserId: user.id,
        reason: "Execution-time block test"
      }
    });
    const event = await createEvent({
      eventType: "EMAIL_SEND_REQUESTED",
      payload: { leadId: lead.id, conversationId: conversation.id }
    });
    const queue = new FakeQueue();
    await dispatchDueDomainEvents({ queue, limit: 10, now: new Date() });

    await expect(
      processDomainEventJob({ eventId: event.id, queueJobId: event.id, workerId: "r12-worker" })
    ).rejects.toThrow("human takeover");

    await expect(workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } }))
      .resolves.toMatchObject({
        status: "ATTENTION_REQUIRED",
        lastErrorCode: "HUMAN_TAKEOVER_ACTIVE"
      });
  });
});
