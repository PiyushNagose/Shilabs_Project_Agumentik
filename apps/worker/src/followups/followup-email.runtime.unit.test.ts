import type { DomainEventOutbox } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attempt: vi.fn(), updateAttempt: vi.fn(), updateEvent: vi.fn(), updateLead: vi.fn(),
  route: vi.fn(), send: vi.fn()
}));
vi.mock("../domain-events/domain-event.repository.js", () => ({ workerPrisma: {
  followUpAttempt: { findFirst: mocks.attempt },
  emailSuppression: { findUnique: () => Promise.resolve(null) },
  humanTakeover: { findFirst: () => Promise.resolve(null) },
  outboundEmail: { findUnique: () => Promise.resolve(null) },
  $transaction: (run: (tx: unknown) => unknown) => run({
    followUpAttempt: { findFirst: mocks.attempt, updateMany: mocks.updateAttempt },
    domainEventOutbox: { updateMany: mocks.updateEvent },
    lead: { updateMany: mocks.updateLead }
  })
} }));
vi.mock("../shared/prospect-inbound.js", () => ({ hasProspectInboundAfter: () => Promise.resolve(false) }));
vi.mock("./preferred-followup.service.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./preferred-followup.service.js")>(),
  routePreferredFollowUp: mocks.route
}));
vi.mock("./zoho-timeline.syncer.js", () => ({ ZohoTimelineSyncer: vi.fn() }));
vi.mock("../calling/calling-automation.service.js", () => ({ scheduleCallingSequenceAfterFailedEmailSequence: vi.fn() }));
vi.mock("./followup-draft.client.js", () => ({ requestFollowUpDraft: vi.fn() }));
vi.mock("../integrations/integration-guard.js", () => ({ assertWorkspaceIntegrationEnabled: vi.fn() }));
vi.mock("../integrations/email.config.js", () => ({ getWorkerSelectedEmailConfig: vi.fn() }));

import { sendFollowUpEmail } from "./followup-email.handler.js";

const event = {
  id: "event", workspaceId: "workspace", attempts: 1, payload: { followUpAttemptId: "attempt" }
} as unknown as DomainEventOutbox;
const past = new Date("2026-01-01T00:00:00Z");
function attempt(nextActionAt: Date | null = null) {
  return {
    id: "attempt", status: "SCHEDULED", stepIndex: 0, scheduledAt: past,
    sequence: { status: "ACTIVE", createdAt: past },
    lead: {
      id: "lead", status: "NEW", automationOwnershipState: "AI_ACTIVE", nextActionAt,
      nextAction: "Share the promised outline", conversations: [],
      contact: { email: "client@example.com", doNotContact: false }
    }
  };
}

describe("worker promise deferral without database access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.attempt.mockResolvedValue(attempt());
    mocks.updateAttempt.mockResolvedValue({ count: 1 });
  });

  it.each(["EMAIL", "WHATSAPP"])("rechecks promises added during generation before %s routing", async (channel) => {
    const promisedAt = new Date(Date.now() + 86_400_000);
    await sendFollowUpEmail({
      event,
      provider: { sendEmail: mocks.send },
      prepareDraft: () => {
        const current = attempt(promisedAt);
        mocks.attempt.mockResolvedValue({ ...current, lead: { ...current.lead, intelligence: { preferredChannel: channel } } });
        return Promise.resolve({ subject: "Outline", textBody: "The agreed outline." });
      }
    });
    expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.updateAttempt).toHaveBeenCalledWith(expect.objectContaining({ data: { scheduledAt: promisedAt } }));
    expect(mocks.updateEvent).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "PENDING", nextAttemptAt: promisedAt, attempts: 0
    }) as unknown }));
    expect(mocks.updateLead).toHaveBeenCalledWith({
      where: { id: "lead", nextActionAt: promisedAt }, data: { nextActionAt: promisedAt }
    });
  });

  it("keeps a later promise when the API returns an older wait date", async () => {
    const olderDate = new Date(Date.now() + 86_400_000);
    const promisedAt = new Date(olderDate.getTime() + 86_400_000);
    mocks.attempt.mockResolvedValueOnce(attempt()).mockResolvedValue(attempt(promisedAt));
    await sendFollowUpEmail({
      event, provider: { sendEmail: mocks.send },
      prepareDraft: () => Promise.resolve({ waitUntil: olderDate.toISOString() })
    });
    expect(mocks.updateAttempt).toHaveBeenCalledWith(expect.objectContaining({ data: { scheduledAt: promisedAt } }));
    expect(mocks.updateLead).toHaveBeenCalledWith({
      where: { id: "lead", nextActionAt: promisedAt }, data: { nextActionAt: promisedAt }
    });
  });

  it("routes a WhatsApp contact without intelligence or an email address", async () => {
    const current = attempt();
    mocks.attempt.mockResolvedValue({ ...current, lead: {
      ...current.lead, contact: { email: null, preferredChannel: "WHATSAPP", doNotContact: false }
    } });
    mocks.route.mockResolvedValue({ route: "routed", channel: "WHATSAPP", status: "QUEUED" });
    await sendFollowUpEmail({
      event, provider: { sendEmail: mocks.send },
      prepareDraft: () => Promise.resolve({ subject: "Outline", textBody: "Agreed outline" })
    });
    expect(mocks.route).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
