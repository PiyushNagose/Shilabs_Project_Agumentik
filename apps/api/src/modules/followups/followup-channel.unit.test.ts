import type { AuthenticatedUser } from "../auth/auth.types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lead: vi.fn(), validateEmail: vi.fn(), generate: vi.fn(), create: vi.fn(), attempt: vi.fn(),
  sequence: vi.fn(), publish: vi.fn()
}));
vi.mock("../../shared/prisma.js", () => ({ prisma: {
  lead: { findUnique: mocks.lead },
  followUpSequence: { findUnique: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: mocks.sequence },
  humanTakeover: { findFirst: vi.fn() },
  $transaction: (run: (tx: unknown) => unknown) => run({
    conversation: { create: () => Promise.resolve({ id: "conversation" }) },
    followUpSequence: { create: mocks.create, updateMany: vi.fn() },
    followUpAttempt: { create: mocks.attempt, update: vi.fn() },
    lead: { update: vi.fn() }, auditEvent: { create: vi.fn() }
  })
} }));
vi.mock("../agents/agent.service.js", () => ({ assertAgentCapabilityActive: vi.fn() }));
vi.mock("../ai/ai.factory.js", () => ({ createAIProvider: () => ({ generateFollowUp: mocks.generate }) }));
vi.mock("../knowledge-base/knowledge-base.service.js", () => ({ listApprovedKnowledge: () => Promise.resolve([]) }));
vi.mock("../domain-events/domain-events.service.js", () => ({ publishDomainEvent: mocks.publish }));
vi.mock("../email/email.service.js", () => ({ validateOutboundEmailPreSend: mocks.validateEmail }));
vi.mock("../leads/lead.permissions.js", () => ({ assertCanAccessLead: vi.fn(), assertCanMutateLead: vi.fn() }));
vi.mock("./followup-policy.service.js", () => ({
  selectFollowUpPolicy: () => Promise.resolve({ id: "policy", name: "Default", cadenceDays: [1] }),
  followUpPolicyCriteria: () => ({}), resolveFollowUpCommunicationPersonality: () => Promise.resolve("PROFESSIONAL")
}));

import { startFollowUpSequence } from "./followup.service.js";

const actor = { id: "actor", activeWorkspaceId: "workspace" } as AuthenticatedUser;
const past = new Date("2026-01-01T00:00:00Z");
function lead(preferredChannel: string, override?: string) {
  return {
    id: "lead", workspaceId: "workspace", company: { name: "Client" }, contactId: "contact", status: "NEW",
    automationOwnershipState: "AI_ACTIVE", contact: { firstName: "Client", lastName: "Name", email: null, preferredChannel, doNotContact: false },
    conversations: [], intelligenceDocuments: [], intelligence: override ? { preferredChannel: override } : null
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockResolvedValue({ body: "Can we confirm the next step?", requiresHumanReview: false });
  mocks.validateEmail.mockResolvedValue({ allowed: true });
  mocks.create.mockResolvedValue({ id: "sequence" });
  mocks.attempt.mockResolvedValue({ id: "attempt", stepIndex: 0, scheduledAt: past });
  mocks.publish.mockResolvedValue({ id: "event" });
  mocks.sequence.mockResolvedValue({
    id: "sequence", status: "ACTIVE", cadenceDays: [1], attempts: [], createdAt: past, updatedAt: past
  });
});

describe("follow-up channel eligibility", () => {
  it.each(["PHONE", "WHATSAPP"])("starts with contact preference %s without intelligence or email", async (channel) => {
    mocks.lead.mockResolvedValue(lead(channel));
    expect(await startFollowUpSequence(actor, "lead", {})).toMatchObject({ status: "ACTIVE" });
    expect(mocks.validateEmail).not.toHaveBeenCalled();
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it("keeps an existing lead EMAIL preference ahead of a contact WhatsApp preference", async () => {
    mocks.lead.mockResolvedValue(lead("WHATSAPP", "EMAIL"));
    await startFollowUpSequence(actor, "lead", {});
    expect(mocks.validateEmail).toHaveBeenCalledWith(actor, { leadId: "lead" });
  });

  it("uses email validation for an invalid contact preference", async () => {
    mocks.lead.mockResolvedValue(lead("invalid"));
    await startFollowUpSequence(actor, "lead", {});
    expect(mocks.validateEmail).toHaveBeenCalledWith(actor, { leadId: "lead" });
  });
});
