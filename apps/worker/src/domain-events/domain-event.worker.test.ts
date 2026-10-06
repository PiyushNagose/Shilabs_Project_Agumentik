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
  await workerPrisma.callingAttempt.deleteMany({
    where: { lead: { source: "r12-worker-test" } }
  });
  await workerPrisma.callingSequence.deleteMany({
    where: { lead: { source: "r12-worker-test" } }
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
  aggregateType?: string;
  aggregateId?: string;
  payload?: Prisma.InputJsonValue;
  attempts?: number;
  maxAttempts?: number;
}) {
  return workerPrisma.domainEventOutbox.create({
    data: {
      eventType: input?.eventType ?? "REPLY_UNDERSTOOD",
      aggregateType: input?.aggregateType ?? "ReplyProcessingRun",
      aggregateId: input?.aggregateId ?? `r12-run-${crypto.randomUUID()}`,
      payload: input?.payload ?? { leadId: "r12-lead" },
      correlationId: `r12-correlation-${crypto.randomUUID()}`,
      idempotencyKey: `r12-domain-event:${crypto.randomUUID()}`,
      attempts: input?.attempts ?? 0,
      maxAttempts: input?.maxAttempts ?? 5,
      priority: "HIGH",
      nextAttemptAt: new Date("2000-01-01T00:00:00.000Z")
    }
  });
}

async function createBlockedLeadFixture() {
  const stage = await workerPrisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await workerPrisma.company.create({
    data: { name: `R12 Company ${crypto.randomUUID()}` }
  });
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
    const added = queue.added.find((job) => job.jobId.startsWith(`${event.id}:`));

    expect(result.dispatched).toBeGreaterThanOrEqual(1);
    expect(added).toBeTruthy();
    await expect(
      workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } })
    ).resolves.toMatchObject({ status: "QUEUED", queueJobId: added?.jobId });
  });

  it("persists QUEUED state before a fast worker can consume the BullMQ job", async () => {
    const event = await createEvent();
    const queue: DomainEventQueueLike = {
      name: "domain-events",
      add: async (_name, data, options) => {
        await expect(
          workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } })
        ).resolves.toMatchObject({ status: "QUEUED", queueJobId: options.jobId });
        await expect(
          processDomainEventJob({
            eventId: (data as { eventId: string }).eventId,
            queueJobId: options.jobId,
            workerId: "r12-fast-worker"
          })
        ).resolves.toBe("PROCESSED");
      }
    };

    await expect(
      dispatchDueDomainEvents({ queue, limit: 1, now: new Date() })
    ).resolves.toMatchObject({
      dispatched: 1
    });
    await expect(
      workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } })
    ).resolves.toMatchObject({ status: "PROCESSED" });
  });

  it("processes internal events and records completion only after processing", async () => {
    const event = await createEvent();
    const queue = new FakeQueue();
    await dispatchDueDomainEvents({ queue, limit: 10, now: new Date() });
    const jobId = queue.added.find((job) => job.jobId.startsWith(`${event.id}:`))?.jobId;
    if (!jobId) throw new Error("Expected queued process job");

    const result = await processDomainEventJob({
      eventId: event.id,
      queueJobId: jobId,
      workerId: "r12-worker"
    });

    expect(result).toBe("PROCESSED");
    await expect(
      workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } })
    ).resolves.toMatchObject({ status: "PROCESSED", attempts: 1, lockedBy: null });
  });

  it.each([
    "MEETING_REQUESTED",
    "NOTIFICATION_ACKNOWLEDGED",
    "PROPOSAL_GENERATED",
    "PROPOSAL_APPROVED",
    "PROPOSAL_SENT"
  ])("treats %s as internal bookkeeping instead of a failure", async (eventType) => {
    const event = await createEvent({ eventType });
    const queue = new FakeQueue();
    await dispatchDueDomainEvents({ queue, limit: 10, now: new Date() });
    const jobId = queue.added.find((job) => job.jobId.startsWith(`${event.id}:`))?.jobId;
    if (!jobId) throw new Error("Expected queued process job");

    await expect(
      processDomainEventJob({ eventId: event.id, queueJobId: jobId, workerId: "r12-worker" })
    ).resolves.toBe("PROCESSED");
    await expect(
      workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } })
    ).resolves.toMatchObject({ status: "PROCESSED" });
  });

  it("moves unsupported events to attention instead of fake success", async () => {
    const event = await createEvent({ eventType: "UNSUPPORTED_EXTERNAL_ACTION" });
    const queue = new FakeQueue();
    await dispatchDueDomainEvents({ queue, limit: 10, now: new Date() });
    const jobId = queue.added.find((job) => job.jobId.startsWith(`${event.id}:`))?.jobId;
    if (!jobId) throw new Error("Expected queued process job");

    await expect(
      processDomainEventJob({ eventId: event.id, queueJobId: jobId, workerId: "r12-worker" })
    ).rejects.toThrow("No worker handler");

    await expect(
      workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } })
    ).resolves.toMatchObject({
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
    const jobId = queue.added.find((job) => job.jobId.startsWith(`${event.id}:`))?.jobId;
    if (!jobId) throw new Error("Expected queued process job");

    await expect(
      processDomainEventJob({ eventId: event.id, queueJobId: jobId, workerId: "r12-worker" })
    ).rejects.toThrow("doNotContact");

    await expect(
      workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } })
    ).resolves.toMatchObject({ status: "ATTENTION_REQUIRED", lastErrorCode: "DO_NOT_CONTACT" });
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
    const jobId = queue.added.find((job) => job.jobId.startsWith(`${event.id}:`))?.jobId;
    if (!jobId) throw new Error("Expected queued process job");

    await expect(
      processDomainEventJob({ eventId: event.id, queueJobId: jobId, workerId: "r12-worker" })
    ).rejects.toThrow("human takeover");

    await expect(
      workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } })
    ).resolves.toMatchObject({
      status: "ATTENTION_REQUIRED",
      lastErrorCode: "HUMAN_TAKEOVER_ACTIVE"
    });
  });

  it("hydrates missing communication context from its persisted aggregate", async () => {
    const { lead } = await createBlockedLeadFixture();
    await workerPrisma.contact.update({
      where: { id: lead.contactId },
      data: { doNotContact: false }
    });
    const sequence = await workerPrisma.callingSequence.create({
      data: {
        leadId: lead.id,
        contactId: lead.contactId,
        cadenceOffsets: [0],
        maxAttempts: 1,
        idempotencyKey: "r12-domain-event:calling-sequence-context"
      }
    });
    const attempt = await workerPrisma.callingAttempt.create({
      data: {
        sequenceId: sequence.id,
        leadId: lead.id,
        contactId: lead.contactId,
        attemptIndex: 0,
        scheduledAt: new Date(),
        idempotencyKey: "r12-domain-event:calling-attempt-context"
      }
    });
    const event = await createEvent({
      eventType: "WHATSAPP_SEND_REQUESTED",
      aggregateType: "CallingAttempt",
      aggregateId: attempt.id,
      payload: { callingAttemptId: attempt.id }
    });
    const queue = new FakeQueue();
    await dispatchDueDomainEvents({ queue, limit: 10, now: new Date() });
    const jobId = queue.added.find((job) => job.jobId.startsWith(`${event.id}:`))?.jobId;
    if (!jobId) throw new Error("Expected queued process job");
    let handledPayload: Prisma.JsonValue | null = null;

    await expect(
      processDomainEventJob({
        eventId: event.id,
        queueJobId: jobId,
        workerId: "r12-worker",
        handlers: {
          WHATSAPP_SEND_REQUESTED: {
            handle: (handledEvent) => {
              handledPayload = handledEvent.payload;
              return Promise.resolve();
            }
          }
        }
      })
    ).resolves.toBe("PROCESSED");

    expect(handledPayload).toMatchObject({ leadId: lead.id, contactId: lead.contactId });
  });

  it("recovers stale queued events and dispatches a fresh BullMQ job id", async () => {
    const staleQueuedAt = new Date("2026-09-17T00:00:00.000Z");
    const dispatchNow = new Date("2026-09-17T00:03:00.000Z");
    const event = await createEvent();
    await workerPrisma.domainEventOutbox.update({
      where: { id: event.id },
      data: {
        status: "QUEUED",
        queueJobId: event.id,
        queuedAt: staleQueuedAt,
        nextAttemptAt: staleQueuedAt
      }
    });
    const queue = new FakeQueue();

    const result = await dispatchDueDomainEvents({ queue, limit: 10, now: dispatchNow });

    expect(result.recovered).toBeGreaterThanOrEqual(1);
    const recoveredJob = queue.added.find((job) => job.jobId.startsWith(`${event.id}:`));
    expect(recoveredJob).toBeTruthy();
    expect(recoveredJob?.jobId).not.toBe(event.id);
    await expect(
      workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } })
    ).resolves.toMatchObject({ status: "QUEUED", queueJobId: recoveredJob?.jobId });
  });

  it("does not let exhausted due events starve a valid follow-up event", async () => {
    const exhausted = await Promise.all(
      Array.from({ length: 30 }, () => createEvent({ attempts: 5, maxAttempts: 5 }))
    );
    const valid = await createEvent();
    const queue = new FakeQueue();

    const result = await dispatchDueDomainEvents({ queue, limit: 1, now: new Date() });

    expect(result.recovered).toBeGreaterThanOrEqual(exhausted.length);
    expect(queue.added.some((job) => job.jobId.startsWith(`${valid.id}:`))).toBe(true);
    await expect(
      workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: valid.id } })
    ).resolves.toMatchObject({ status: "QUEUED" });
    await expect(
      workerPrisma.domainEventOutbox.count({
        where: { id: { in: exhausted.map((event) => event.id) }, status: "ATTENTION_REQUIRED" }
      })
    ).resolves.toBe(exhausted.length);
  });
});
