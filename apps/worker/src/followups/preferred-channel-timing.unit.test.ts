import type { DomainEventOutbox } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    followUpAttempt: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    followUpSequence: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    callingAttempt: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    callingSequence: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    domainEventOutbox: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    voiceCallAttempt: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    outboundWhatsAppMessage: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    humanTakeover: { findFirst: vi.fn(), count: vi.fn() },
    conversation: { count: vi.fn() },
    activity: { create: vi.fn(), findFirst: vi.fn() },
    auditEvent: { create: vi.fn() }, lead: { updateMany: vi.fn() },
    externalRecordMapping: { upsert: vi.fn() }
  },
  integration: vi.fn(), agent: vi.fn(), inbound: vi.fn(),
  call: vi.fn(), whatsapp: vi.fn()
}));
vi.mock("../domain-events/domain-event.repository.js", () => ({ workerPrisma: mocks.db }));
vi.mock("../integrations/integration-guard.js", () => ({ assertWorkspaceIntegrationEnabled: mocks.integration }));
vi.mock("../shared/agent-control.js", () => ({ isAgentCapabilityActive: mocks.agent }));
vi.mock("../shared/prospect-inbound.js", () => ({ hasProspectInboundAfter: mocks.inbound }));
vi.mock("./zoho-timeline.syncer.js", () => ({ ZohoTimelineSyncer: vi.fn() }));

import { deferChannelAttemptForPromise, resolvePreferredFollowUpChannel, routePreferredFollowUp } from "./preferred-followup.service.js";
import { executeCallingAutomationAttempt, scheduleCallingSequenceAfterFailedEmailSequence } from "../calling/calling-automation.service.js";
import { executeWhatsAppSend } from "../messaging/whatsapp-send.service.js";

const env = {
  NODE_ENV: "development", VOICE_PROVIDER: "twilio", VOICE_WEBHOOK_BASE_URL: "https://voice.example.test",
  TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "test", TWILIO_FROM_NUMBER: "+15557654321",
  MESSAGING_PROVIDER: "meta_whatsapp", WHATSAPP_ACCESS_TOKEN: "test", WHATSAPP_PHONE_NUMBER_ID: "test",
  WHATSAPP_DEFAULT_TEMPLATE_NAME: "test", WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE: "en"
};
const past = new Date("2026-01-01T00:00:00Z");
const future = () => new Date(Date.now() + 86_400_000);
function attempt(channel: "PHONE" | "WHATSAPP", nextActionAt: Date | null = null) {
  return {
    id: "calling", leadId: "lead", contactId: "contact", sequenceId: "sequence", attemptIndex: 0,
    idempotencyKey: "calling-key", status: "SCHEDULED", scheduledAt: past,
    sequence: {
      id: "sequence", workspaceId: "workspace", status: "ACTIVE", createdAt: past,
      currentAttempt: 0, followUpSequence: { status: "ACTIVE", createdAt: past }
    },
    lead: {
      id: "lead", workspaceId: "workspace", contactId: "contact", status: "NEW", automationOwnershipState: "AI_ACTIVE",
      nextAction: "Share the promised outline", nextActionAt,
      contact: { doNotContact: false, phone: "+15551234567", whatsappId: "15551234567" },
      intelligence: { preferredChannel: channel, aiControlStatus: "ON", humanInterventionRequired: false },
      conversations: []
    }
  };
}
function event(channel: "PHONE" | "WHATSAPP") {
  return {
    id: "event", workspaceId: "workspace", attempts: 2,
    payload: { leadId: "lead", contactId: "contact", callingAttemptId: "calling", preferredChannel: channel, textBody: "Agreed outline" }
  } as unknown as DomainEventOutbox;
}
const timelineSyncer = { syncActivity: () => Promise.resolve({ status: "SYNCED" as const, externalRecordId: "sync", lastError: null }) };
function dispatch(channel: "PHONE" | "WHATSAPP") {
  return channel === "PHONE"
    ? executeCallingAutomationAttempt({ event: event(channel), env, provider: { createOutboundCall: mocks.call }, timelineSyncer })
    : executeWhatsAppSend({ event: event(channel), env, provider: { sendTemplateMessage: mocks.whatsapp }, timelineSyncer });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.$transaction.mockImplementation((run: (tx: unknown) => unknown) => run(mocks.db));
  mocks.db.callingAttempt.findFirst.mockResolvedValue(attempt("PHONE"));
  mocks.db.callingAttempt.create.mockImplementation(({ data }: { data: { scheduledAt: Date } }) => Promise.resolve({ id: "calling", ...data }));
  mocks.db.callingSequence.create.mockResolvedValue({ id: "sequence" });
  mocks.db.domainEventOutbox.create.mockResolvedValue({ id: "routed-event" });
  mocks.db.domainEventOutbox.upsert.mockResolvedValue({ id: "schedule-event" });
  mocks.db.domainEventOutbox.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.followUpAttempt.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.voiceCallAttempt.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.voiceCallAttempt.create.mockResolvedValue({ id: "voice", status: "PROVIDER_PENDING" });
  mocks.db.voiceCallAttempt.update.mockResolvedValue({ id: "voice" });
  mocks.db.outboundWhatsAppMessage.upsert.mockResolvedValue({ id: "whatsapp" });
  mocks.db.humanTakeover.count.mockResolvedValue(0);
  mocks.db.conversation.count.mockResolvedValue(0);
  mocks.db.activity.create.mockResolvedValue({ id: "activity" });
  mocks.agent.mockResolvedValue(true);
  mocks.inbound.mockResolvedValue(false);
  mocks.call.mockResolvedValue({ status: "ACCEPTED", providerCallId: "remote-call", providerStatus: "queued", lastError: null });
});

describe("preferred-channel promised dates", () => {
  it("inherits valid contact preferences only when the lead has no override", () => {
    expect(resolvePreferredFollowUpChannel({ contact: { preferredChannel: "WHATSAPP" } })).toBe("WHATSAPP");
    expect(resolvePreferredFollowUpChannel({ contact: { preferredChannel: "PHONE" } })).toBe("PHONE");
    expect(resolvePreferredFollowUpChannel({ contact: { preferredChannel: "invalid" } })).toBe("EMAIL");
    expect(resolvePreferredFollowUpChannel({ contact: { preferredChannel: "WHATSAPP" }, intelligence: { preferredChannel: "EMAIL" } })).toBe("EMAIL");
  });
  it.each(["PHONE", "WHATSAPP"] as const)("schedules routed %s work for the promise and retains its description", async (channel) => {
    const promisedAt = future();
    const current = attempt(channel, promisedAt);
    mocks.db.followUpAttempt.findFirst.mockResolvedValue({
      ...current, id: "followup", subject: "Outline", outboundEmailId: null,
      sequence: { ...current.sequence, contactId: "contact" }
    });
    await routePreferredFollowUp({ event: event(channel), attemptId: "followup", textBody: "Outline" });
    expect(mocks.db.callingAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ scheduledAt: promisedAt }) as unknown
    }));
    expect(mocks.db.domainEventOutbox.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ nextAttemptAt: promisedAt }) as unknown
    }));
    expect(mocks.db.lead.updateMany).toHaveBeenCalledWith({
      where: { id: "lead", nextActionAt: promisedAt },
      data: { nextAction: "Share the promised outline", nextActionAt: promisedAt }
    });
  });

  it.each(["PHONE", "WHATSAPP"] as const)("defers %s when a promise is added after routing", async (channel) => {
    const promisedAt = future();
    mocks.db.callingAttempt.findFirst.mockResolvedValue(attempt(channel, promisedAt));
    await dispatch(channel);
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.whatsapp).not.toHaveBeenCalled();
    expect(mocks.db.voiceCallAttempt.create).not.toHaveBeenCalled();
    expect(mocks.db.outboundWhatsAppMessage.upsert).not.toHaveBeenCalled();
    expect(mocks.db.domainEventOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: "event", workspaceId: "workspace", status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "PENDING", nextAttemptAt: promisedAt, attempts: 1, queueJobId: null, queuedAt: null, lockedAt: null, lockedBy: null }
    });
    expect(mocks.db.callingAttempt.update).toHaveBeenCalledWith({ where: { id: "calling" }, data: { scheduledAt: promisedAt } });
    expect(mocks.db.lead.updateMany).not.toHaveBeenCalled();
  });

  it.each(["PHONE", "WHATSAPP"] as const)("rechecks %s timing immediately before transport", async (channel) => {
    const promisedAt = future();
    mocks.db.callingAttempt.findFirst.mockResolvedValue(attempt(channel));
    mocks.integration.mockImplementation(() => {
      mocks.db.callingAttempt.findFirst.mockResolvedValue(attempt(channel, promisedAt));
      return Promise.resolve();
    });
    await dispatch(channel);
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.whatsapp).not.toHaveBeenCalled();
    expect(mocks.db.domainEventOutbox.updateMany).toHaveBeenCalled();
    if (channel === "PHONE") {
      expect(mocks.db.voiceCallAttempt.updateMany).toHaveBeenCalledWith({
        where: { id: "voice", providerCallId: null, status: "PROVIDER_PENDING" },
        data: { status: "REQUESTED", failureCode: "VOICE_PROMISE_DEFERRED" }
      });
      expect(mocks.db.callingAttempt.update).toHaveBeenLastCalledWith({
        where: { id: "calling" }, data: { scheduledAt: promisedAt, status: "SCHEDULED", startedAt: null }
      });
    }
  });

  it("resumes a locally deferred call using the same reservation once the promise is due", async () => {
    mocks.db.voiceCallAttempt.findUnique.mockResolvedValue({ id: "voice", status: "REQUESTED", failureCode: "VOICE_PROMISE_DEFERRED", providerCallId: null });
    await dispatch("PHONE");
    expect(mocks.db.voiceCallAttempt.create).not.toHaveBeenCalled();
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.db.callingAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ACCEPTED" }) as unknown
    }));
  });

  it("does not resume a deferred reservation another worker has claimed", async () => {
    mocks.db.voiceCallAttempt.findUnique.mockResolvedValue({ id: "voice", status: "REQUESTED", failureCode: "VOICE_PROMISE_DEFERRED", providerCallId: null });
    mocks.db.voiceCallAttempt.updateMany.mockResolvedValue({ count: 0 });
    await dispatch("PHONE");
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.db.callingAttempt.update).not.toHaveBeenCalled();
  });

  it.each(["PHONE", "WHATSAPP"] as const)("routes and checks %s inherited from contact when intelligence is absent", async (channel) => {
    const current = attempt(channel, future());
    const lead = { ...current.lead, intelligence: null, contact: { ...current.lead.contact, preferredChannel: channel } };
    mocks.db.followUpAttempt.findFirst.mockResolvedValue({
      ...current, id: "followup", lead, outboundEmailId: null,
      sequence: { ...current.sequence, contactId: "contact" }
    });
    expect(await routePreferredFollowUp({ event: event(channel), attemptId: "followup", textBody: "Outline" }))
      .toMatchObject({ route: "routed", channel, status: "QUEUED" });
    mocks.db.callingAttempt.findFirst.mockResolvedValue({ ...current, lead });
    await dispatch(channel);
    expect(mocks.db.domainEventOutbox.updateMany).toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.whatsapp).not.toHaveBeenCalled();
  });

  it("keeps uncertain calls in manual review even with a future promise", async () => {
    mocks.db.callingAttempt.findFirst.mockResolvedValue(attempt("PHONE", future()));
    mocks.db.voiceCallAttempt.findUnique.mockResolvedValue({ id: "voice", status: "PROVIDER_PENDING", providerCallId: null });
    await expect(dispatch("PHONE")).rejects.toMatchObject({ code: "VOICE_PROVIDER_OUTCOME_UNKNOWN" });
    expect(mocks.db.domainEventOutbox.updateMany).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it.each(["PHONE", "WHATSAPP"] as const)("preserves human guards when %s also has a future promise", async (channel) => {
    const current = attempt(channel, future());
    current.lead.automationOwnershipState = "HUMAN_REQUIRED";
    mocks.db.callingAttempt.findFirst.mockResolvedValue(current);
    await expect(dispatch(channel)).rejects.toMatchObject({ code: "AI_OWNERSHIP_INACTIVE" });
    expect(mocks.db.domainEventOutbox.updateMany).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.whatsapp).not.toHaveBeenCalled();
  });

  it("does not shorten the persisted attempt schedule to an earlier promise", async () => {
    const promisedAt = future();
    const scheduledAt = new Date(promisedAt.getTime() + 86_400_000);
    mocks.db.callingAttempt.findFirst.mockResolvedValue({ ...attempt("PHONE", promisedAt), scheduledAt });
    expect(await deferChannelAttemptForPromise(event("PHONE"), "calling")).toBe(true);
    expect(mocks.db.callingAttempt.update).toHaveBeenCalledWith({ where: { id: "calling" }, data: { scheduledAt } });
  });

  it("anchors existing calling offsets at the promise while preserving the human description", async () => {
    const promisedAt = future();
    mocks.db.followUpSequence.findUnique.mockResolvedValue({
      id: "followup", workspaceId: "workspace", leadId: "lead", contactId: "contact",
      status: "COMPLETED", createdAt: past, attempts: [{ status: "SENT" }], lead: attempt("PHONE", promisedAt).lead
    });
    await scheduleCallingSequenceAfterFailedEmailSequence({
      followUpSequenceId: "followup", now: past,
      env: { ...env, CALLING_AUTOMATION_ENABLED: "true", CALLING_AUTOMATION_ATTEMPTS_SAME_DAY: "2",
        CALLING_AUTOMATION_SAME_DAY_SPACING_MINUTES: "60", CALLING_AUTOMATION_WAIT_DAYS_AFTER_SAME_DAY: "3", CALLING_AUTOMATION_MAX_ATTEMPTS: "3" }
    });
    for (const [index, offset] of [0, 60, 4320].entries()) {
      expect(mocks.db.callingAttempt.create).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
        data: expect.objectContaining({ scheduledAt: new Date(promisedAt.getTime() + offset * 60_000) }) as unknown
      }));
    }
    expect(mocks.db.lead.updateMany).toHaveBeenCalledWith({
      where: { id: "lead", nextActionAt: promisedAt, nextAction: "Share the promised outline" },
      data: { nextAction: "Share the promised outline", nextActionAt: promisedAt }
    });
  });

  it.each(["PHONE", "WHATSAPP"] as const)("does not defer or resend an already accepted %s transport", async (channel) => {
    const current = attempt(channel, future());
    if (channel === "PHONE") {
      mocks.db.callingAttempt.findFirst.mockResolvedValue({ ...current, status: "ACCEPTED", voiceCallAttempt: { providerCallId: "remote-call" } });
    } else {
      mocks.db.callingAttempt.findFirst.mockResolvedValue(current);
      mocks.db.outboundWhatsAppMessage.findUnique.mockResolvedValue({ id: "whatsapp", status: "SENT", zohoSyncStatus: "SYNCED" });
    }
    await dispatch(channel);
    expect(mocks.db.domainEventOutbox.updateMany).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.whatsapp).not.toHaveBeenCalled();
  });
});
