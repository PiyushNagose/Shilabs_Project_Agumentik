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
    where: { idempotencyKey: { startsWith: "r13-worker-domain-event:" } }
  });
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
  const stage = await workerPrisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await workerPrisma.company.create({ data: { name: `R13 Worker ${crypto.randomUUID()}` } });
  const contact = await workerPrisma.contact.create({
    data: {
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
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source: "r13-worker-followup"
    }
  });
  const conversation = await workerPrisma.conversation.create({
    data: { leadId: lead.id, channel: "EMAIL", mode: "AUTO" }
  });
  const sequence = await workerPrisma.followUpSequence.create({
    data: {
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
  return { event, attempt };
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
});
