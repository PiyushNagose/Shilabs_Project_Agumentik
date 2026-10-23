import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import { sendFollowUpEmail as sendProductionFollowUpEmail } from "./followup-email.handler.js";
import type {
  WorkerEmailProvider,
  WorkerEmailSendInput
} from "../integrations/aws-ses.provider.js";
import {
  ZohoTimelineSyncer,
  type TimelineSyncer,
  type TimelineSyncResult
} from "./zoho-timeline.syncer.js";

async function sendFollowUpEmail(
  input: Parameters<typeof sendProductionFollowUpEmail>[0]
): Promise<void> {
  await sendProductionFollowUpEmail({
    ...input,
    prepareDraft:
      input.prepareDraft ??
      (async ({ attemptId }) => {
        const attempt = await workerPrisma.followUpAttempt.findUniqueOrThrow({
          where: { id: attemptId }
        });
        return { subject: attempt.subject, textBody: attempt.textBody };
      })
  });
}

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
      this.results.shift() ?? {
        status: "SYNCED",
        externalRecordId: "zoho-note-default",
        lastError: null
      }
    );
  }
}

async function cleanup(): Promise<void> {
  await workerPrisma.domainEventOutbox.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: "r13-worker-domain-event:" } },
        { idempotencyKey: { startsWith: "domain-event:calling-attempt:" } },
        { idempotencyKey: { startsWith: "domain-event:whatsapp-send:" } },
        { idempotencyKey: { startsWith: "preferred-follow-up:" } }
      ]
    }
  });
  await workerPrisma.outboundWhatsAppMessage.deleteMany({
    where: { lead: { source: "r13-worker-followup" } }
  });
  await workerPrisma.callingAttempt.deleteMany({
    where: { lead: { source: "r13-worker-followup" } }
  });
  await workerPrisma.callingSequence.deleteMany({
    where: { lead: { source: "r13-worker-followup" } }
  });
  await workerPrisma.followUpAttempt.deleteMany({
    where: { lead: { source: "r13-worker-followup" } }
  });
  await workerPrisma.followUpSequence.deleteMany({
    where: { lead: { source: "r13-worker-followup" } }
  });
  await workerPrisma.outboundEmail.deleteMany({
    where: { lead: { source: "r13-worker-followup" } }
  });
  await workerPrisma.message.deleteMany({
    where: { conversation: { lead: { source: "r13-worker-followup" } } }
  });
  await workerPrisma.conversation.deleteMany({
    where: { lead: { source: "r13-worker-followup" } }
  });
  await workerPrisma.activity.deleteMany({ where: { lead: { source: "r13-worker-followup" } } });
  await workerPrisma.auditEvent.deleteMany({ where: { entityType: "FollowUpAttempt" } });
  await workerPrisma.leadIntelligence.deleteMany({
    where: { lead: { source: "r13-worker-followup" } }
  });
  await workerPrisma.lead.deleteMany({ where: { source: "r13-worker-followup" } });
  await workerPrisma.contact.deleteMany({ where: { source: "r13-worker-followup" } });
  await workerPrisma.company.deleteMany({ where: { name: { startsWith: "R13 Worker" } } });
}

async function fixture() {
  const workspace = await workerPrisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const stage = await workerPrisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await workerPrisma.company.create({
    data: { workspaceId: workspace.id, name: `R13 Worker ${crypto.randomUUID()}` }
  });
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
      source: "r13-worker-followup",
      automationOwnershipState: "AI_ACTIVE"
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
  const company = await workerPrisma.company.create({
    data: { workspaceId: workspace.id, name: `R13 Worker ${crypto.randomUUID()}` }
  });
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
      source: "r13-worker-followup",
      automationOwnershipState: "AI_ACTIVE"
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
        scheduledAt: new Date(Date.now() - (4 - index) * 60_000),
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
  it.each(["PHONE", "WHATSAPP"] as const)(
    "routes %s without requiring or sending email",
    async (preferredChannel) => {
      const { event, lead, attempt } = await fixture();
      if (!lead.workspaceId) throw new Error("Fixture workspace is missing");
      await workerPrisma.contact.update({
        where: { id: lead.contactId },
        data: { email: null, normalizedEmail: null, phone: "+15551234567" }
      });
      await workerPrisma.leadIntelligence.create({
        data: {
          leadId: lead.id,
          workspaceId: lead.workspaceId,
          preferredChannel,
          contextSnapshot: {},
          evidence: []
        }
      });
      const provider = new TestEmailProvider();
      await sendFollowUpEmail({ event, provider });
      expect(provider.calls).toHaveLength(0);
      expect(await workerPrisma.outboundEmail.count({ where: { leadId: lead.id } })).toBe(0);
      expect(
        await workerPrisma.followUpAttempt.findUnique({ where: { id: attempt.id } })
      ).toMatchObject({ status: "SKIPPED", sentAt: null, failureCode: "PREFERRED_CHANNEL_ROUTED" });
      expect(
        await workerPrisma.domainEventOutbox.findUnique({
          where: { idempotencyKey: `preferred-follow-up:${attempt.id}` }
        })
      ).toMatchObject({
        eventType:
          preferredChannel === "PHONE" ? "CALL_AUTOMATION_ATTEMPT_DUE" : "WHATSAPP_SEND_REQUESTED",
        status: "PENDING"
      });
    }
  );

  it("does not mistake a classified automatic reply for a customer reply", async () => {
    const { event, lead, sequence } = await fixture();
    if (!sequence.conversationId) throw new Error("Fixture conversation is missing");
    await workerPrisma.message.create({
      data: {
        workspaceId: lead.workspaceId,
        conversationId: sequence.conversationId,
        direction: "INBOUND",
        senderType: "PROSPECT",
        body: "Out of office",
        metadata: { inboundClassification: { version: 1, kind: "NONMEANINGFUL" } }
      }
    });
    const provider = new TestEmailProvider();
    await sendFollowUpEmail({
      event,
      provider,
      env: {
        AWS_SES_REGION: "us-east-1",
        AWS_SES_FROM_EMAIL: "sales@example.com",
        AWS_SES_ACCESS_KEY_ID: "test",
        AWS_SES_SECRET_ACCESS_KEY: "test"
      },
      timelineSyncer: new TestTimelineSyncer([])
    });
    expect(provider.calls).toHaveLength(1);
  });

  it("preserves a pending review draft when a queued job is delivered again", async () => {
    const { event, attempt, sequence } = await fixture();
    await workerPrisma.followUpSequence.update({ where: { id: sequence.id }, data: { status: "ATTENTION_REQUIRED" } });
    await workerPrisma.followUpAttempt.update({ where: { id: attempt.id }, data: {
      status: "BLOCKED", failureCode: "FOLLOW_UP_REQUIRES_REVIEW",
      failureMessage: "Discount needs approval", textBody: "Review this commercial request."
    } });
    const provider = new TestEmailProvider();
    await sendFollowUpEmail({ event, provider });
    await sendFollowUpEmail({ event, provider });
    expect(provider.calls).toHaveLength(0);
    expect(await workerPrisma.followUpAttempt.findUnique({ where: { id: attempt.id } })).toMatchObject({
      status: "BLOCKED", failureCode: "FOLLOW_UP_REQUIRES_REVIEW",
      failureMessage: "Discount needs approval", textBody: "Review this commercial request."
    });
  });

  it("defers a promised follow-up date without sending or consuming a retry", async () => {
    const { event, attempt, lead } = await fixture();
    const provider = new TestEmailProvider();
    const waitUntil = new Date(Date.now() + 86_400_000).toISOString();
    await workerPrisma.lead.update({
      where: { id: lead.id },
      data: { nextAction: "Share the promised implementation outline" }
    });
    await sendFollowUpEmail({
      event,
      provider,
      prepareDraft: () => Promise.resolve({ waitUntil })
    });
    expect(provider.calls).toHaveLength(0);
    await expect(
      workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } })
    ).resolves.toMatchObject({
      status: "PENDING",
      nextAttemptAt: new Date(waitUntil),
      attempts: 0
    });
    await expect(
      workerPrisma.followUpAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    ).resolves.toMatchObject({ status: "SCHEDULED", scheduledAt: new Date(waitUntil) });
    await expect(
      workerPrisma.lead.findUniqueOrThrow({ where: { id: lead.id } })
    ).resolves.toMatchObject({ nextActionAt: new Date(waitUntil), nextAction: "Share the promised implementation outline" });
  }, 45000);
  it("defers a promise recorded during generation before sending or routing", async () => {
    const { event, attempt, lead } = await fixture();
    const provider = new TestEmailProvider();
    const promisedAt = new Date(Date.now() + 2 * 86_400_000);
    await sendFollowUpEmail({
      event,
      provider,
      prepareDraft: async () => {
        await workerPrisma.lead.update({
          where: { id: lead.id },
          data: { nextAction: "Share the agreed outline on Friday", nextActionAt: promisedAt }
        });
        return { subject: "Outline", textBody: "Here is the outline." };
      }
    });
    expect(provider.calls).toHaveLength(0);
    expect(await workerPrisma.outboundEmail.count({ where: { leadId: lead.id } })).toBe(0);
    expect(await workerPrisma.followUpAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
      .toMatchObject({ status: "SCHEDULED", scheduledAt: promisedAt });
    expect(await workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: event.id } }))
      .toMatchObject({ status: "PENDING", nextAttemptAt: promisedAt, attempts: 0 });
    expect(await workerPrisma.lead.findUniqueOrThrow({ where: { id: lead.id } }))
      .toMatchObject({ nextAction: "Share the agreed outline on Friday", nextActionAt: promisedAt });
  });
  it("sends freshly prepared content and records AI attribution", async () => {
    const { event, attempt, lead } = await fixture();
    const provider = new TestEmailProvider();
    const textBody = "The updated discovery scope includes approval routing.";
    await workerPrisma.outboundEmail.create({
      data: {
        workspaceId: lead.workspaceId,
        leadId: lead.id,
        contactId: lead.contactId,
        toEmail: "r13-worker@example.com",
        normalizedToEmail: "r13-worker@example.com",
        fromEmail: "sales@example.com",
        subject: "Discovery scope",
        textBody: "Human response",
        provider: "AWS_SES",
        status: "SENT",
        senderType: "USER",
        sentAt: new Date(),
        providerMessageId: "<human-response@example.com>",
        threadId: "existing-discovery-thread",
        providerReferences: ["<first-message@example.com>"],
        idempotencyKey: `r13-human-${lead.id}`
      }
    });
    await sendFollowUpEmail({
      event,
      provider,
      env: {
        AWS_SES_REGION: "us-east-1",
        AWS_SES_FROM_EMAIL: "sales@example.com",
        AWS_SES_ACCESS_KEY_ID: "test",
        AWS_SES_SECRET_ACCESS_KEY: "test"
      },
      timelineSyncer: new TestTimelineSyncer([]),
      prepareDraft: () => Promise.resolve({ subject: "Updated discovery", textBody })
    });
    expect(provider.calls[0]).toMatchObject({
      subject: "Updated discovery",
      textBody,
      threadId: "existing-discovery-thread",
      inReplyTo: "<human-response@example.com>",
      references: ["<first-message@example.com>", "<human-response@example.com>"]
    });
    await expect(
      workerPrisma.outboundEmail.findUniqueOrThrow({
        where: { idempotencyKey: attempt.idempotencyKey }
      })
    ).resolves.toMatchObject({ textBody, senderType: "AI" });
    await expect(
      workerPrisma.message.findFirstOrThrow({ where: { conversation: { leadId: lead.id } } })
    ).resolves.toMatchObject({ body: textBody, senderType: "AI" });
  }, 45000);

  it("does not send if the client replies during draft preparation", async () => {
    const { event, lead } = await fixture();
    const provider = new TestEmailProvider();
    await sendFollowUpEmail({
      event,
      provider,
      prepareDraft: async () => {
        await workerPrisma.lead.update({
          where: { id: lead.id },
          data: { automationOwnershipState: "HUMAN_REQUIRED" }
        });
        return { subject: "Must not send", textBody: "Must not send" };
      }
    });
    expect(provider.calls).toHaveLength(0);
  }, 45000);
  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await workerPrisma.$disconnect();
  }, 45000);

  it("syncs Zoho timeline after SES success", async () => {
    const { event, attempt, lead } = await fixture();
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
    await expect(
      workerPrisma.followUpAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    ).resolves.toMatchObject({ status: "SENT", zohoSyncStatus: "SYNCED", zohoLastError: null });
    await expect(
      workerPrisma.outboundEmail.findUniqueOrThrow({
        where: { idempotencyKey: attempt.idempotencyKey }
      })
    ).resolves.toMatchObject({ status: "SENT", providerMessageId: "ses-r13-1" });
    const refreshedLead = await workerPrisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(refreshedLead.lastActivityAt).not.toBeNull();
    expect(refreshedLead.lastActivityAt?.getTime()).toBeGreaterThanOrEqual(
      attempt.scheduledAt.getTime()
    );
  }, 45000);

  it("skips Zoho credentials for a native CRM lead without an external mapping", async () => {
    const { lead } = await fixture();
    const activity = await workerPrisma.activity.create({
      data: {
        workspaceId: lead.workspaceId,
        leadId: lead.id,
        type: "MESSAGE_SENT",
        description: "Native CRM activity"
      }
    });
    const syncer = new ZohoTimelineSyncer(workerPrisma);

    await expect(
      syncer.syncActivity({
        activityId: activity.id,
        env: {
          ZOHO_BIGIN_CLIENT_ID: "",
          ZOHO_BIGIN_CLIENT_SECRET: "",
          ZOHO_BIGIN_REFRESH_TOKEN: ""
        },
        transport: () => Promise.reject(new Error("Zoho transport must not be called"))
      })
    ).resolves.toEqual({ status: "SKIPPED", externalRecordId: null, lastError: null });
  }, 45000);

  it("blocks a scheduled send when lead-level AI is paused", async () => {
    const { event, attempt, lead, sequence } = await fixture();
    if (!lead.workspaceId) throw new Error("Fixture lead requires a workspace");
    await workerPrisma.leadIntelligence.create({
      data: {
        workspaceId: lead.workspaceId,
        leadId: lead.id,
        aiControlStatus: "PAUSED",
        objections: [],
        commitments: [],
        customCadenceDays: [],
        contextSnapshot: {},
        evidence: []
      }
    });
    const provider = new TestEmailProvider();

    await expect(sendFollowUpEmail({ event, provider })).rejects.toThrow("Lead-level AI is paused");

    expect(provider.calls).toHaveLength(0);
    await expect(
      workerPrisma.followUpAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    ).resolves.toMatchObject({ status: "BLOCKED", failureCode: "AI_CONTROL_PAUSED" });
    await expect(
      workerPrisma.followUpSequence.findUniqueOrThrow({ where: { id: sequence.id } })
    ).resolves.toMatchObject({ status: "STOPPED", stopReason: "AI_CONTROL_PAUSED" });
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

    await expect(
      workerPrisma.lead.findUniqueOrThrow({ where: { id: lead.id } })
    ).resolves.toMatchObject({
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

    await expect(sendFollowUpEmail({ event, provider, env, timelineSyncer })).rejects.toThrow(
      "Zoho timeout"
    );
    await expect(
      workerPrisma.followUpSequence.findUniqueOrThrow({ where: { id: attempt.sequenceId } })
    ).resolves.toMatchObject({ currentStep: 1 });
    await sendFollowUpEmail({ event, provider, env, timelineSyncer });

    expect(provider.calls).toHaveLength(1);
    expect(timelineSyncer.calls).toHaveLength(2);
    await expect(
      workerPrisma.followUpAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    ).resolves.toMatchObject({ status: "SENT", zohoSyncStatus: "SYNCED" });
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
    await expect(
      workerPrisma.outboundEmail.findUniqueOrThrow({
        where: { idempotencyKey: attempt.idempotencyKey }
      })
    ).resolves.toMatchObject({ status: "SENT" });
    await expect(
      workerPrisma.followUpAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    ).resolves.toMatchObject({
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

    await expect(
      workerPrisma.followUpAttempt.findUniqueOrThrow({ where: { id: finalAttempt.id } })
    ).resolves.toMatchObject({ status: "SENT" });
    await expect(
      workerPrisma.followUpSequence.findUniqueOrThrow({ where: { id: sequence.id } })
    ).resolves.toMatchObject({ status: "ACTIVE", completedAt: null, currentStep: 2 });
    await expect(
      workerPrisma.domainEventOutbox.findUniqueOrThrow({ where: { id: queuedMiddleEvent.id } })
    ).resolves.toMatchObject({ status: "QUEUED" });
    await expect(workerPrisma.callingSequence.count({ where: { leadId: lead.id } })).resolves.toBe(
      0
    );
    await expect(
      workerPrisma.domainEventOutbox.count({
        where: {
          eventType: "WHATSAPP_SEND_REQUESTED",
          payload: { path: ["leadId"], equals: lead.id }
        }
      })
    ).resolves.toBe(0);
  }, 45000);
});
