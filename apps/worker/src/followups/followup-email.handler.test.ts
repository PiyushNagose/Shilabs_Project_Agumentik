import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import { sendFollowUpEmail } from "./followup-email.handler.js";
import type { WorkerEmailProvider, WorkerEmailSendInput } from "../integrations/aws-ses.provider.js";
import type { TimelineSyncer, TimelineSyncResult } from "./zoho-timeline.syncer.js";

class TestEmailProvider implements WorkerEmailProvider {
  public calls: WorkerEmailSendInput[] = [];

  public sendEmail(input: WorkerEmailSendInput): Promise<{ providerMessageId: string }> {
    this.calls.push(input);
    return Promise.resolve({ providerMessageId: `ses-r13-${String(this.calls.length)}` });
  }
}

class TestTimelineSyncer implements TimelineSyncer {
  public calls: string[] = [];
  public results: TimelineSyncResult[];

  public constructor(results: TimelineSyncResult[]) {
    this.results = [...results];
  }

  public syncActivity(input: { activityId: string }): Promise<TimelineSyncResult> {
    this.calls.push(input.activityId);
    return Promise.resolve(
      this.results.shift() ?? { status: "SYNCED", externalRecordId: "zoho-note-default", lastError: null }
    );
  }
}

async function cleanup(): Promise<void> {
  await workerPrisma.domainEventOutbox.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: "r13-worker-domain-event:" } },
        { idempotencyKey: { startsWith: "domain-event:calling-attempt:" } },
        { idempotencyKey: { startsWith: "domain-event:whatsapp-send:" } }
      ]
    }
  });
  await workerPrisma.outboundWhatsAppMessage.deleteMany({ where: { lead: { source: "r13-worker-followup" } } });
  await workerPrisma.callingAttempt.deleteMany({ where: { lead: { source: "r13-worker-followup" } } });
  await workerPrisma.callingSequence.deleteMany({ where: { lead: { source: "r13-worker-followup" } } });
  await workerPrisma.followUpAttempt.deleteMany({ where: { lead: { source: "r13-worker-followup" } } });
  await workerPrisma.followUpSequence.deleteMany({ where: { lead: { source: "r13-worker-followup" } } });
  await workerPrisma.outboundEmail.deleteMany({ where: { lead: { source: "r13-worker-followup" } } });
  await workerPrisma.message.deleteMany({ where: { conversation: { lead: { source: "r13-worker-followup" } } } });
  await workerPrisma.conversation.deleteMany({ where: { lead: { source: "r13-worker-followup" } } });
  await workerPrisma.activity.deleteMany({ where: { lead: { source: "r13-worker-followup" } } });
  await workerPrisma.auditEvent.deleteMany({ where: { entityType: "FollowUpAttempt" } });
  await workerPrisma.lead.deleteMany({ where: { source: "r13-worker-followup" } });
  await workerPrisma.contact.deleteMany({ where: { source: "r13-worker-followup" } });
  await workerPrisma.company.deleteMany({ where: { name: { startsWith: "R13 Worker" } } });
}

async function fixture() {
  const workspace = await workerPrisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const stage = await workerPrisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await workerPrisma.company.create({ data: { workspaceId: workspace.id, name: `R13 Worker ${crypto.randomUUID()}` } });
  const contact = await workerPrisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "Worker",
      lastName: "Lead",
      email: "r13-worker@example.com",
      normalizedEmail: "r13-worker@example.com",
      source: "r13-worker-followup"
    }
  });
  const lead = await workerPrisma.lead.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source: "r13-worker-followup"
    }
  });
  const conversation = await workerPrisma.conversation.create({
    data: { workspaceId: workspace.id, leadId: lead.id, channel: "EMAIL", mode: "AUTO" }
  });
  const sequence = await workerPrisma.followUpSequence.create({
    data: {
      workspaceId: workspace.id,
      leadId: lead.id,
      contactId: contact.id,
      conversationId: conversation.id,
      cadenceDays: [0, 1, 5, 9],
      idempotencyKey: `r13-worker-sequence:${lead.id}`
    }
  });
  const attempt = await workerPrisma.followUpAttempt.create({
    data: {
      sequenceId: sequence.id,
      leadId: lead.id,
      stepIndex: 0,
      kind: "FIRST_EMAIL",
      scheduledAt: new Date(),
      subject: "Following up",
      textBody: "Hello from Shilabs",
      idempotencyKey: `r13-worker-attempt:${sequence.id}:0`
    }
  });
  const event = await workerPrisma.domainEventOutbox.create({
    data: {
      workspaceId: workspace.id,
      eventType: "FOLLOWUP_EMAIL_SEND_REQUESTED",
      aggregateType: "FollowUpAttempt",
      aggregateId: attempt.id,
      payload: {
        followUpSequenceId: sequence.id,
        followUpAttemptId: attempt.id,
        leadId: lead.id,
        conversationId: conversation.id,
        stepIndex: 0
      },
      correlationId: sequence.id,
      idempotencyKey: `r13-worker-domain-event:${attempt.id}`
    }
  });
  return { event, attempt, lead, sequence };
}

async function outOfOrderFinalAttemptFixture() {
  const workspace = await workerPrisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const stage = await workerPrisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await workerPrisma.company.create({ data: { workspaceId: workspace.id, name: `R13 Worker ${crypto.randomUUID()}` } });
  const contact = await workerPrisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "Worker",
      lastName: "OutOfOrder",
      email: "r13-worker-out-of-order@example.com",
      normalizedEmail: "r13-worker-out-of-order@example.com",
      phone: "+919999000002",
      normalizedPhone: "+919999000002",
      source: "r13-worker-followup"
    }
  });
  const lead = await workerPrisma.lead.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source: "r13-worker-followup"
    }
  });
  const conversation = await workerPrisma.conversation.create({
    data: { workspaceId: workspace.id, leadId: lead.id, channel: "EMAIL", mode: "AUTO" }
  });
  const sequence = await workerPrisma.followUpSequence.create({
    data: {
      workspaceId: workspace.id,
      leadId: lead.id,
      contactId: contact.id,
      conversationId: conversation.id,
      cadenceDays: [0, 1, 5, 9],
      idempotencyKey: `r13-worker-sequence:${lead.id}`
    }
  });
  const attempts = [];
  const events = [];
  for (const index of [0, 1, 2, 3]) {
    const sent = index < 2;
    const attempt = await workerPrisma.followUpAttempt.create({
      data: {
        sequenceId: sequence.id,
        leadId: lead.id,
        stepIndex: index,
        kind: index === 0 ? "FIRST_EMAIL" : "FOLLOW_UP",
        status: sent ? "SENT" : "SCHEDULED",
        scheduledAt: new Date(Date.now() + index * 60_000),
        sentAt: sent ? new Date(Date.now() - (4 - index) * 60_000) : null,
        subject: `Following up ${String(index)}`,
        textBody: `Hello from Shilabs ${String(index)}`,
        idempotencyKey: `r13-worker-attempt:${sequence.id}:${String(index)}`
      }
    });
    const event = await workerPrisma.domainEventOutbox.create({
      data: {
        workspaceId: workspace.id,
        eventType: "FOLLOWUP_EMAIL_SEND_REQUESTED",
        aggregateType: "FollowUpAttempt",
        aggregateId: attempt.id,
        payload: {
          followUpSequenceId: sequence.id,
          followUpAttemptId: attempt.id,
          leadId: lead.id,
          conversationId: conversation.id,
          stepIndex: index
        },
        status: index < 2 ? "PROCESSED" : index === 2 ? "QUEUED" : "PROCESSING",
        processedAt: index < 2 ? new Date(Date.now() - (4 - index) * 60_000) : null,
        correlationId: sequence.id,
        idempotencyKey: `r13-worker-domain-event:${attempt.id}`,
        queueJobId: index === 3 ? `r13-worker-job:${attempt.id}` : null,
        queuedAt: index >= 2 ? new Date() : null,
        lockedAt: index === 3 ? new Date() : null,
        lockedBy: index === 3 ? "r13-worker-test" : null
      }
    });
    await workerPrisma.followUpAttempt.update({
      where: { id: attempt.id },
      data: { domainEventId: event.id }
    });
    attempts.push({ ...attempt, domainEventId: event.id });
    events.push(event);
  }
  const finalAttempt = attempts[3];
  const finalEvent = events[3];
  const queuedMiddleEvent = events[2];
  if (!finalAttempt || !finalEvent || !queuedMiddleEvent) {
    throw new Error("Out-of-order final attempt fixture was not created");
  }
  return { lead, sequence, finalAttempt, finalEvent, queuedMiddleEvent };
}

describe("R13 follow-up email worker handler", () => {
  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await workerPrisma.$disconnect();
  }, 45000);

  it("syncs Zoho timeline after SES success", async () => {
    const { event, attempt } = await fixture();
    const provider = new TestEmailProvider();
    const timelineSyncer = new TestTimelineSyncer([
      { status: "SYNCED", externalRecordId: "zoho-note-1", lastError: null }
    ]);
    const env = {
      AWS_SES_REGION: "us-east-1",
      AWS_SES_FROM_EMAIL: "sales@example.com",
      AWS_SES_ACCESS_KEY_ID: "test",
      AWS_SES_SECRET_ACCESS_KEY: "test"
    };

    await sendFollowUpEmail({ event, provider, env, timelineSyncer });

    expect(provider.calls).toHaveLength(1);
    expect(timelineSyncer.calls).toHaveLength(1);
    await expect(workerPrisma.followUpAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
      .resolves.toMatchObject({ status: "SENT", zohoSyncStatus: "SYNCED", zohoLastError: null });
    await expect(
      workerPrisma.outboundEmail.findUniqueOrThrow({ where: { idempotencyKey: attempt.idempotencyKey } })
    ).resolves.toMatchObject({ status: "SENT", providerMessageId: "ses-r13-1" });
  }, 45000);

  it("advances lead next action to the next active scheduled follow-up after a send", async () => {
    const { event, attempt, lead, sequence } = await fixture();
    const nextScheduledAt = new Date(Date.now() + 60_000);
    await workerPrisma.lead.update({
      where: { id: lead.id },
      data: { nextAction: "Send first follow-up email", nextActionAt: attempt.scheduledAt }
    });
    await workerPrisma.followUpAttempt.create({
      data: {
        sequenceId: sequence.id,
        leadId: lead.id,
        stepIndex: 1,
        kind: "FOLLOW_UP",
        scheduledAt: nextScheduledAt,
        subject: "Following up again",
        textBody: "Checking back in",
        idempotencyKey: `r13-worker-attempt:${sequence.id}:1`
      }
    });
    const provider = new TestEmailProvider();
    const timelineSyncer = new TestTimelineSyncer([
      { status: "SYNCED", externalRecordId: "zoho-note-next-action", lastError: null }
    ]);
    const env = {
      AWS_SES_REGION: "us-east-1",
      AWS_SES_FROM_EMAIL: "sales@example.com",
      AWS_SES_ACCESS_KEY_ID: "test",
      AWS_SES_SECRET_ACCESS_KEY: "test"
    };

    await sendFollowUpEmail({ event, provider, env, timelineSyncer });

    await expect(workerPrisma.lead.findUniqueOrThrow({ where: { id: lead.id } }))
      .resolves.toMatchObject({
        nextAction: "Send follow-up email 2",
        nextActionAt: nextScheduledAt
      });
  }, 45000);

  it("retries Zoho only after SES success and never resends", async () => {
    const { event, attempt } = await fixture();
    const provider = new TestEmailProvider();
    const timelineSyncer = new TestTimelineSyncer([
      { status: "FAILED", externalRecordId: null, lastError: "Zoho timeout" },
      { status: "SYNCED", externalRecordId: "zoho-note-2", lastError: null }
    ]);
    const env = {
      AWS_SES_REGION: "us-east-1",
      AWS_SES_FROM_EMAIL: "sales@example.com",
      AWS_SES_ACCESS_KEY_ID: "test",
      AWS_SES_SECRET_ACCESS_KEY: "test"
    };

    await expect(sendFollowUpEmail({ event, provider, env, timelineSyncer })).rejects.toThrow("Zoho timeout");
    await sendFollowUpEmail({ event, provider, env, timelineSyncer });

    expect(provider.calls).toHaveLength(1);
    expect(timelineSyncer.calls).toHaveLength(2);
    await expect(workerPrisma.followUpAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
      .resolves.toMatchObject({ status: "SENT", zohoSyncStatus: "SYNCED" });
  }, 45000);

  it("duplicate processing never creates duplicate Zoho timeline entries", async () => {
    const { event } = await fixture();
    const provider = new TestEmailProvider();
    const timelineSyncer = new TestTimelineSyncer([
      { status: "SYNCED", externalRecordId: "zoho-note-3", lastError: null },
      { status: "SKIPPED", externalRecordId: "zoho-note-3", lastError: null }
    ]);
    const env = {
      AWS_SES_REGION: "us-east-1",
      AWS_SES_FROM_EMAIL: "sales@example.com",
      AWS_SES_ACCESS_KEY_ID: "test",
      AWS_SES_SECRET_ACCESS_KEY: "test"
    };

    await sendFollowUpEmail({ event, provider, env, timelineSyncer });
    await sendFollowUpEmail({ event, provider, env, timelineSyncer });

    expect(provider.calls).toHaveLength(1);
    expect(timelineSyncer.calls).toHaveLength(2);
  }, 45000);

  it("missing Zoho config stays visible without changing confirmed email send", async () => {
    const { event, attempt } = await fixture();
    const provider = new TestEmailProvider();
    const timelineSyncer = new TestTimelineSyncer([
      {
        status: "NOT_CONFIGURED",
        externalRecordId: null,
        lastError: "Missing configuration: ZOHO_BIGIN_CLIENT_ID"
      }
    ]);
    const env = {
      AWS_SES_REGION: "us-east-1",
      AWS_SES_FROM_EMAIL: "sales@example.com",
      AWS_SES_ACCESS_KEY_ID: "test",
      AWS_SES_SECRET_ACCESS_KEY: "test"
    };

    await expect(sendFollowUpEmail({ event, provider, env, timelineSyncer })).rejects.toThrow(
      "Missing configuration"
    );

    expect(provider.calls).toHaveLength(1);
    await expect(workerPrisma.outboundEmail.findUniqueOrThrow({ where: { idempotencyKey: attempt.idempotencyKey } }))
      .resolves.toMatchObject({ status: "SENT" });
    await expect(workerPrisma.followUpAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
      .resolves.toMatchObject({
        status: "SENT",
        zohoSyncStatus: "FAILED",
        zohoLastError: "Missing configuration: ZOHO_BIGIN_CLIENT_ID"
      });
  }, 45000);

  it("does not complete R13 or create R23 when an earlier required attempt event is still queued", async () => {
    const { lead, sequence, finalAttempt, finalEvent, queuedMiddleEvent } =
      await outOfOrderFinalAttemptFixture();
    const provider = new TestEmailProvider();
    const timelineSyncer = new TestTimelineSyncer([
      { status: "SYNCED", externalRecordId: "zoho-note-final", lastError: null }
    ]);
    const env = {
      AWS_SES_REGION: "us-east-1",
      AWS_SES_FROM_EMAIL: "sales@example.com",
      AWS_SES_ACCESS_KEY_ID: "test",
      AWS_SES_SECRET_ACCESS_KEY: "test",
      CALLING_AUTOMATION_ENABLED: "true",
      CALLING_AUTOMATION_ATTEMPTS_SAME_DAY: "2",
      CALLING_AUTOMATION_SAME_DAY_SPACING_MINUTES: "60",
      CALLING_AUTOMATION_WAIT_DAYS_AFTER_SAME_DAY: "3",
      CALLING_AUTOMATION_MAX_ATTEMPTS: "3"
    };

    await sendFollowUpEmail({ event: finalEvent, provider, env, timelineSyncer });

    await expect(workerPrisma.followUpAttempt.findUniqueOrThrow({ where: { id: finalAttempt.id } }))
      .resolves.toMatchObject({ status: "SENT" });
    await expect(workerPrisma.followUpSequence.findUniqueOrThrow({ where: { id: sequence.id } }))
      .resolves.toMatchObject({ status: "ACTIVE", completedAt: null, currentStep: 2 });
    await expect(workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: queuedMiddleEvent.id } }))
      .resolves.toMatchObject({ status: "QUEUED" });
    await expect(workerPrisma.callingSequence.count({ where: { leadId: lead.id } })).resolves.toBe(0);
    await expect(workerPrisma.domainEventOutbox.count({
      where: { eventType: "WHATSAPP_SEND_REQUESTED", payload: { path: ["leadId"], equals: lead.id } }
    })).resolves.toBe(0);
  }, 45000);
});
