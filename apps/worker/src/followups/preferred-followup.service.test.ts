import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadPreferredChannel } from "@prisma/client";
import { workerPrisma as db } from "../domain-events/domain-event.repository.js";
import { executeCallingAutomationAttempt } from "../calling/calling-automation.service.js";
import { executeWhatsAppSend } from "../messaging/whatsapp-send.service.js";
import {
  hasMeaningfulProspectInboundAfter,
  isNonMeaningfulInboundMetadata
} from "../shared/prospect-inbound.js";
import { routePreferredFollowUp } from "./preferred-followup.service.js";

const source = "preferred-followup-worker-test";
const marker = {
  inboundClassification: {
    version: 1,
    kind: "NONMEANINGFUL",
    reason: "AUTO_SUBMITTED_AUTO_REPLIED"
  }
};
const env = {
  NODE_ENV: "development",
  VOICE_PROVIDER: "twilio",
  VOICE_WEBHOOK_BASE_URL: "https://voice.example.test",
  TWILIO_ACCOUNT_SID: "ACtest",
  TWILIO_AUTH_TOKEN: "test",
  TWILIO_FROM_NUMBER: "+15557654321",
  MESSAGING_PROVIDER: "meta_whatsapp",
  WHATSAPP_ACCESS_TOKEN: "test",
  WHATSAPP_PHONE_NUMBER_ID: "test",
  WHATSAPP_DEFAULT_TEMPLATE_NAME: "test",
  WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE: "en"
};
const timelineSyncer = {
  syncActivity: vi
    .fn()
    .mockResolvedValue({ status: "SYNCED", externalRecordId: "preferred-test", lastError: null })
};

async function clean() {
  const leads = { source };
  await db.externalRecordMapping.deleteMany({
    where: {
      OR: [
        {
          entityType: "CALL",
          localEntityId: {
            in: (
              await db.voiceCallAttempt.findMany({ where: { lead: leads }, select: { id: true } })
            ).map((row) => row.id)
          }
        },
        {
          entityType: "WHATSAPP_MESSAGE",
          localEntityId: {
            in: (
              await db.outboundWhatsAppMessage.findMany({
                where: { lead: leads },
                select: { id: true }
              })
            ).map((row) => row.id)
          }
        }
      ]
    }
  });
  await db.domainEventOutbox.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: "preferred-test:" } },
        { idempotencyKey: { startsWith: "preferred-follow-up:" } },
        {
          aggregateId: {
            in: (
              await db.voiceCallAttempt.findMany({ where: { lead: leads }, select: { id: true } })
            ).map((row) => row.id)
          }
        },
        {
          aggregateId: {
            in: (
              await db.outboundWhatsAppMessage.findMany({
                where: { lead: leads },
                select: { id: true }
              })
            ).map((row) => row.id)
          }
        }
      ]
    }
  });
  await db.outboundWhatsAppMessage.deleteMany({ where: { lead: leads } });
  await db.callingSequence.deleteMany({ where: { lead: leads } });
  await db.voiceCallAttempt.deleteMany({ where: { lead: leads } });
  await db.followUpSequence.deleteMany({ where: { lead: leads } });
  await db.inboundEmail.deleteMany({ where: { lead: leads } });
  await db.message.deleteMany({ where: { conversation: { lead: leads } } });
  await db.conversation.deleteMany({ where: { lead: leads } });
  await db.activity.deleteMany({ where: { lead: leads } });
  await db.auditEvent.deleteMany({
    where: {
      entityId: {
        in: (await db.lead.findMany({ where: leads, select: { id: true } })).map((row) => row.id)
      }
    }
  });
  await db.lead.deleteMany({ where: leads });
  await db.contact.deleteMany({ where: { source } });
  await db.company.deleteMany({ where: { name: { startsWith: source } } });
}

async function fixture(channel: LeadPreferredChannel = "PHONE") {
  const workspace = await db.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const stage = await db.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await db.company.create({
    data: { workspaceId: workspace.id, name: `${source}-${crypto.randomUUID()}` }
  });
  const contact = await db.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "Preferred",
      lastName: "Channel",
      source,
      phone: "+15551234567",
      whatsappId: "+15551234567"
    }
  });
  const lead = await db.lead.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source,
      automationOwnershipState: "AI_ACTIVE",
      intelligence: {
        create: {
          workspaceId: workspace.id,
          preferredChannel: channel,
          contextSnapshot: {},
          evidence: []
        }
      }
    }
  });
  const sequence = await db.followUpSequence.create({
    data: {
      workspaceId: workspace.id,
      leadId: lead.id,
      contactId: contact.id,
      cadenceDays: [1, 5, 9],
      idempotencyKey: `preferred-test:${lead.id}`
    }
  });
  const attempt = await db.followUpAttempt.create({
    data: {
      sequenceId: sequence.id,
      leadId: lead.id,
      stepIndex: 0,
      kind: "FOLLOW_UP",
      scheduledAt: new Date(),
      subject: "Old subject",
      textBody: "Old body",
      idempotencyKey: `preferred-test:attempt:${lead.id}`
    }
  });
  const event = await db.domainEventOutbox.create({
    data: {
      workspaceId: workspace.id,
      eventType: "FOLLOWUP_EMAIL_SEND_REQUESTED",
      aggregateType: "FollowUpAttempt",
      aggregateId: attempt.id,
      correlationId: sequence.id,
      payload: { leadId: lead.id, followUpAttemptId: attempt.id },
      idempotencyKey: `preferred-test:event:${lead.id}`
    }
  });
  return {
    lead,
    sequence,
    attempt,
    event,
    routeInput: {
      event,
      attemptId: attempt.id,
      textBody: "Fresh follow-up body",
      subject: "Fresh subject",
      env
    }
  };
}

async function inbound(leadId: string, automatic: boolean, linked = true) {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  const conversation = await db.conversation.create({
    data: { workspaceId: lead.workspaceId, leadId, channel: "EMAIL", mode: "AUTO" }
  });
  const message = await db.message.create({
    data: {
      workspaceId: lead.workspaceId,
      conversationId: conversation.id,
      direction: "INBOUND",
      senderType: "PROSPECT",
      body: automatic ? "Out of office" : "Stop contacting me",
      ...(automatic ? { metadata: marker } : {})
    }
  });
  if (linked)
    await db.inboundEmail.create({
      data: {
        workspaceId: lead.workspaceId,
        provider: "AWS_SES",
        providerMessageId: `preferred-test:${message.id}`,
        leadId,
        messageId: message.id,
        fromEmail: "client@example.test",
        normalizedFromEmail: "client@example.test",
        toEmails: ["sales@example.test"],
        textBody: message.body,
        rawProviderPayload: {},
        status: "PROCESSED",
        replyProcessingStatus: automatic ? "SKIPPED" : "PENDING",
        receivedAt: new Date()
      }
    });
  return message;
}

async function routedEvent(value: Awaited<ReturnType<typeof fixture>>) {
  const route = await routePreferredFollowUp(value.routeInput);
  if (route.route !== "routed" || !route.domainEventId) throw new Error("Expected queued routing");
  return db.domainEventOutbox.findUniqueOrThrow({ where: { id: route.domainEventId } });
}

beforeEach(clean);
afterAll(async () => {
  await clean();
  await db.$disconnect();
});

describe("preferred follow-up routing", () => {
  it.each(["EMAIL", "MIXED"] as const)("keeps %s on the email path", async (channel) => {
    const value = await fixture(channel);
    expect(await routePreferredFollowUp(value.routeInput)).toEqual({ route: "email" });
    expect(await db.callingAttempt.count({ where: { leadId: value.lead.id } })).toBe(0);
    expect(
      (await db.followUpAttempt.findUniqueOrThrow({ where: { id: value.attempt.id } })).status
    ).toBe("SCHEDULED");
  });

  it.each(["PHONE", "WHATSAPP"] as const)(
    "queues %s once without claiming email sent",
    async (channel) => {
      const value = await fixture(channel);
      await inbound(value.lead.id, true);
      const [first, second] = await Promise.all([
        routePreferredFollowUp(value.routeInput),
        routePreferredFollowUp(value.routeInput)
      ]);
      expect(first.route).toBe("routed");
      expect(second.route).toBe("routed");
      const event = await routedEvent(value);
      expect(event.eventType).toBe(
        channel === "PHONE" ? "CALL_AUTOMATION_ATTEMPT_DUE" : "WHATSAPP_SEND_REQUESTED"
      );
      expect(event.payload).toMatchObject({
        textBody: "Fresh follow-up body",
        preferredChannel: channel,
        sourceEventId: value.event.id
      });
      expect(await db.callingAttempt.count({ where: { leadId: value.lead.id } })).toBe(1);
      expect(await db.outboundEmail.count({ where: { leadId: value.lead.id } })).toBe(0);
      expect(
        await db.followUpAttempt.findUniqueOrThrow({ where: { id: value.attempt.id } })
      ).toMatchObject({
        status: "SKIPPED",
        failureCode: "PREFERRED_CHANNEL_ROUTED",
        sentAt: null,
        outboundEmailId: null,
        textBody: "Fresh follow-up body"
      });
    }
  );

  it("rejects cross-workspace attempts", async () => {
    const value = await fixture();
    await expect(
      routePreferredFollowUp({
        ...value.routeInput,
        event: { ...value.event, workspaceId: "other-workspace" }
      })
    ).rejects.toMatchObject({ code: "FOLLOW_UP_ATTEMPT_NOT_FOUND" });
  });

  it("never takes over an email attempt already claimed for sending", async () => {
    const value = await fixture();
    await db.followUpAttempt.update({
      where: { id: value.attempt.id },
      data: { status: "SENDING" }
    });
    expect(await routePreferredFollowUp(value.routeInput)).toMatchObject({
      route: "routed",
      status: "BLOCKED"
    });
    expect(await db.callingAttempt.count({ where: { leadId: value.lead.id } })).toBe(0);
    expect(
      (await db.followUpAttempt.findUniqueOrThrow({ where: { id: value.attempt.id } })).status
    ).toBe("SENDING");
  });

  it.each(["DNC", "AI_OFF", "HUMAN_REQUIRED", "INBOUND"])(
    "blocks %s before queuing",
    async (reason) => {
      const value = await fixture();
      if (reason === "DNC")
        await db.contact.update({
          where: { id: value.lead.contactId },
          data: { doNotContact: true }
        });
      if (reason === "AI_OFF")
        await db.leadIntelligence.update({
          where: { leadId: value.lead.id },
          data: { aiControlStatus: "OFF" }
        });
      if (reason === "HUMAN_REQUIRED")
        await db.lead.update({
          where: { id: value.lead.id },
          data: { automationOwnershipState: "HUMAN_REQUIRED" }
        });
      if (reason === "INBOUND") await inbound(value.lead.id, false);
      expect(await routePreferredFollowUp(value.routeInput)).toMatchObject({
        route: "routed",
        status: "BLOCKED"
      });
      expect(await db.callingAttempt.count({ where: { leadId: value.lead.id } })).toBe(0);
    }
  );

  it.each(["PHONE", "WHATSAPP"] as const)(
    "dispatches %s with persisted provider acceptance and ignores automatic inbound",
    async (channel) => {
      const value = await fixture(channel);
      await db.followUpSequence.update({
        where: { id: value.sequence.id },
        data: { cadenceDays: [1] }
      });
      const event = await routedEvent(value);
      await inbound(value.lead.id, true);
      const createOutboundCall = vi.fn().mockResolvedValue({
        status: "ACCEPTED",
        providerCallId: `CA-${crypto.randomUUID()}`,
        providerStatus: "queued",
        lastError: null
      });
      const sendTemplateMessage = vi.fn().mockResolvedValue({
        status: "ACCEPTED",
        providerMessageId: `wamid-${crypto.randomUUID()}`,
        providerStatus: "accepted",
        lastError: null
      });
      if (channel === "PHONE") {
        await executeCallingAutomationAttempt({
          event,
          env,
          provider: { createOutboundCall },
          timelineSyncer
        });
        expect(
          await db.voiceCallAttempt.findFirst({ where: { leadId: value.lead.id } })
        ).toMatchObject({ status: "QUEUED" });
        expect(
          (await db.voiceCallAttempt.findFirstOrThrow({ where: { leadId: value.lead.id } }))
            .providerCallId
        ).toEqual(expect.any(String));
        expect(sendTemplateMessage).not.toHaveBeenCalled();
      } else {
        await executeWhatsAppSend({
          event,
          env,
          provider: { sendTemplateMessage },
          timelineSyncer
        });
        expect(sendTemplateMessage).toHaveBeenCalledWith(
          expect.objectContaining({ textBody: "Fresh follow-up body" })
        );
        expect(
          await db.outboundWhatsAppMessage.findFirst({ where: { leadId: value.lead.id } })
        ).toMatchObject({ status: "SENT" });
        expect(
          (await db.outboundWhatsAppMessage.findFirstOrThrow({ where: { leadId: value.lead.id } }))
            .providerMessageId
        ).toEqual(expect.any(String));
        expect(createOutboundCall).not.toHaveBeenCalled();
      }
      expect(
        (await db.followUpAttempt.findUniqueOrThrow({ where: { id: value.attempt.id } })).sentAt
      ).toBeNull();
      expect(
        await db.followUpSequence.findUnique({ where: { id: value.sequence.id } })
      ).toMatchObject({ status: "COMPLETED", currentStep: 1 });
      expect(await db.lead.findUnique({ where: { id: value.lead.id } })).toMatchObject({
        nextAction: "Review completed follow-up schedule",
        nextActionAt: null
      });
      const execute = channel === "PHONE" ? executeCallingAutomationAttempt : executeWhatsAppSend;
      await execute({
        event,
        env,
        provider: { createOutboundCall, sendTemplateMessage },
        timelineSyncer
      });
      expect(channel === "PHONE" ? createOutboundCall : sendTemplateMessage).toHaveBeenCalledTimes(
        1
      );
    }
  );

  it.each(["PHONE", "WHATSAPP"] as const)(
    "stops queued %s when a human reply arrives",
    async (channel) => {
      const value = await fixture(channel);
      const event = await routedEvent(value);
      await inbound(value.lead.id, false);
      const provider = { createOutboundCall: vi.fn(), sendTemplateMessage: vi.fn() };
      const execute = channel === "PHONE" ? executeCallingAutomationAttempt : executeWhatsAppSend;
      await expect(execute({ event, env, provider, timelineSyncer })).rejects.toMatchObject({
        code: "INBOUND_REPLY_RECEIVED"
      });
      expect(provider.createOutboundCall).not.toHaveBeenCalled();
      expect(provider.sendTemplateMessage).not.toHaveBeenCalled();
    }
  );

  it.each(["PHONE", "WHATSAPP"] as const)(
    "blocks queued %s if the preference changes",
    async (channel) => {
      const value = await fixture(channel);
      const event = await routedEvent(value);
      await db.leadIntelligence.update({
        where: { leadId: value.lead.id },
        data: { preferredChannel: "EMAIL" }
      });
      const execute = channel === "PHONE" ? executeCallingAutomationAttempt : executeWhatsAppSend;
      await expect(execute({ event, env })).rejects.toMatchObject({
        code: "PREFERRED_CHANNEL_CHANGED"
      });
    }
  );

  it.each(["PHONE", "WHATSAPP"] as const)(
    "persists %s provider rejection without email success",
    async (channel) => {
      const value = await fixture(channel);
      const event = await routedEvent(value);
      const provider = {
        createOutboundCall: vi
          .fn()
          .mockResolvedValue({ status: "FAILED", providerCallId: null, lastError: "Rejected" }),
        sendTemplateMessage: vi
          .fn()
          .mockResolvedValue({ status: "FAILED", providerMessageId: null, lastError: "Rejected" })
      };
      const execute = channel === "PHONE" ? executeCallingAutomationAttempt : executeWhatsAppSend;
      await expect(execute({ event, env, provider, timelineSyncer })).rejects.toThrow("Rejected");
      const record =
        channel === "PHONE"
          ? await db.voiceCallAttempt.findFirstOrThrow({ where: { leadId: value.lead.id } })
          : await db.outboundWhatsAppMessage.findFirstOrThrow({ where: { leadId: value.lead.id } });
      expect(record.failureMessage).toBe("Rejected");
      expect(record.status).not.toBe("SENT");
    }
  );

  it.each(["PHONE", "WHATSAPP"] as const)("persists thrown %s provider errors", async (channel) => {
    const value = await fixture(channel);
    const event = await routedEvent(value);
    const provider = {
      createOutboundCall: vi.fn().mockRejectedValue(new Error("Transport failed")),
      sendTemplateMessage: vi.fn().mockRejectedValue(new Error("Transport failed"))
    };
    const execute = channel === "PHONE" ? executeCallingAutomationAttempt : executeWhatsAppSend;
    await expect(execute({ event, env, provider, timelineSyncer })).rejects.toThrow(
      "Transport failed"
    );
    const record =
      channel === "PHONE"
        ? await db.voiceCallAttempt.findFirstOrThrow({ where: { leadId: value.lead.id } })
        : await db.outboundWhatsAppMessage.findFirstOrThrow({ where: { leadId: value.lead.id } });
    expect(record).toMatchObject({ status: "FAILED", failureMessage: "Transport failed" });
  });

  it("keeps legacy metadata and unlinked processed inbound meaningful", async () => {
    const value = await fixture();
    const since = value.sequence.createdAt;
    await inbound(value.lead.id, true);
    expect(await hasMeaningfulProspectInboundAfter({ leadId: value.lead.id, since })).toBe(false);
    expect(
      isNonMeaningfulInboundMetadata({ inboundClassification: { kind: "NONMEANINGFUL" } })
    ).toBe(false);
    await db.inboundEmail.create({
      data: {
        provider: "AWS_SES",
        providerMessageId: crypto.randomUUID(),
        leadId: value.lead.id,
        fromEmail: "client@example.test",
        normalizedFromEmail: "client@example.test",
        toEmails: [],
        textBody: "Legacy reply",
        rawProviderPayload: {},
        status: "PROCESSED",
        receivedAt: new Date()
      }
    });
    expect(await hasMeaningfulProspectInboundAfter({ leadId: value.lead.id, since })).toBe(true);
  });
});
