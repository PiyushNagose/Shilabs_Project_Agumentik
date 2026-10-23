import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";

const mocks = vi.hoisted(() => ({
  lead: vi.fn(), controls: vi.fn(), attempt: vi.fn(), decision: vi.fn(),
  activity: vi.fn(), audit: vi.fn(), human: vi.fn(), stop: vi.fn(),
  upsert: vi.fn<(input: { create: { preferredChannel: string }; update: Record<string, unknown> }) => Promise<void>>(),
  record: vi.fn()
}));
vi.mock("../../shared/prisma.js", () => ({ prisma: {
  lead: { findFirst: mocks.lead },
  leadIntelligence: { findUnique: mocks.controls, findUniqueOrThrow: mocks.record },
  leadDocument: { findMany: () => Promise.resolve([]) },
  leadIntelligenceDecision: { findFirst: () => Promise.resolve(null) },
  followUpAttempt: { findFirst: mocks.attempt },
  $transaction: (run: (tx: unknown) => unknown) => run({
    leadIntelligenceDecision: { create: mocks.decision },
    leadIntelligence: { upsert: mocks.upsert },
    activity: { create: mocks.activity }, auditEvent: { create: mocks.audit }
  })
} }));
vi.mock("../leads/lead-automation-ownership.service.js", () => ({
  requireHumanAction: mocks.human, stopAi: mocks.stop, completeHumanAction: vi.fn(),
  isTerminalLeadStatus: (status: string) => ["WON", "LOST", "DISQUALIFIED"].includes(status)
}));
vi.mock("../leads/lead.permissions.js", () => ({ assertCanAccessLead: vi.fn(), leadVisibilityWhere: vi.fn() }));
vi.mock("../realtime/realtime.service.js", () => ({ publishRealtimeEvent: vi.fn() }));
vi.mock("../followups/followup-reschedule.service.js", () => ({ rescheduleLeadFollowUpsInTransaction: vi.fn() }));

import { decideFollowUpAttempt, refreshLeadIntelligence, splitDocument } from "./lead-intelligence.service.js";

const past = new Date("2026-01-01T00:00:00Z");
function message(body: string, senderType = "PROSPECT", createdAt = past, metadata = {}) {
  return { id: body, body, senderType, direction: senderType === "PROSPECT" ? "INBOUND" : "OUTBOUND", createdAt, metadata };
}
function lead(messages: ReturnType<typeof message>[] = []) {
  return {
    id: "lead", workspaceId: "workspace", automationOwnershipState: "AI_ACTIVE",
    status: "NEW", score: 50, stage: { label: "Discovery" },
    contact: { doNotContact: false }, company: { name: "Client" },
    conversations: [{ messages }], activities: [], tasks: [], proposals: [],
    meetingRequests: [], intelligenceDocuments: [], followUpAttempts: [],
    requirement: "Approval routing", nextActionAt: null
  };
}

describe("persisted send-time decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lead.mockResolvedValue(lead());
    mocks.controls.mockResolvedValue(null);
    mocks.record.mockResolvedValue({
      id: "intelligence", leadId: "lead", aiControlStatus: "ON", preferredChannel: "EMAIL",
      evidence: [], objections: [], commitments: [], customCadenceDays: [],
      lastRefreshedAt: past, createdAt: past, updatedAt: past
    });
    mocks.attempt.mockResolvedValue({
      id: "attempt", scheduledAt: past, stepIndex: 0,
      sequence: { createdAt: past, cadenceDays: [0], cadenceMode: "PRODUCTION_DAYS" }
    });
    mocks.decision.mockImplementation(({ data }) => Promise.resolve({ ...data, id: "decision", createdAt: past }));
  });

  it("evaluates the exact workspace attempt and records grounded guidance with unavailable engagement evidence", async () => {
    const result = await decideFollowUpAttempt("workspace", "lead", "attempt");
    expect(mocks.lead).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "lead", workspaceId: "workspace" } }));
    expect(mocks.attempt).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: "attempt", leadId: "lead", status: "SCHEDULED", sequence: { workspaceId: "workspace", status: "ACTIVE" }
    } }));
    expect(result).toMatchObject({ decision: "FOLLOW_UP", factors: {
      followUpAttemptId: "attempt", replyReason: expect.stringContaining("Approval routing") as unknown,
      engagementEvidence: { opens: "unavailable", clicks: "unavailable", linkInteractions: "unavailable" }
    } });
    expect(result.evidence).toContainEqual(expect.objectContaining({ sourceId: "lead:lead", quote: "Approval routing" }));
    expect(mocks.human).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("retains human promises as the strongest reply reason and bounds adaptation after unanswered sends", async () => {
    const record = lead([
      message("We will share the technical outline.", "USER", new Date("2026-01-02")),
      message("Please explain approval routing.")
    ]);
    mocks.lead.mockResolvedValue({ ...record, followUpAttempts: [
      { status: "SENT", sentAt: new Date("2026-01-03") },
      { status: "SENT", sentAt: new Date("2026-01-04") },
      { status: "SCHEDULED", sentAt: null }
    ] });
    const result = await decideFollowUpAttempt("workspace", "lead", "attempt");
    expect(result.factors).toMatchObject({
      replyReason: expect.stringContaining("We will share the technical outline.") as unknown,
      unansweredFollowUpCount: 2, sentFollowUpCount: 2,
      adaptation: expect.stringContaining("whether to continue") as unknown
    });
    expect(result.evidence[0]).toMatchObject({ sourceType: "MESSAGE", quote: "We will share the technical outline." });
  });

  it("escalates risky client context before any draft can be generated", async () => {
    mocks.lead.mockResolvedValue(lead([message("We need a discount on pricing.")]));
    const result = await decideFollowUpAttempt("workspace", "lead", "attempt");
    expect(result).toMatchObject({ decision: "ESCALATE", guardrailCode: "HIGH_RISK_CLIENT_CONTEXT" });
    expect(mocks.human).toHaveBeenCalledWith(expect.objectContaining({ leadId: "lead", sourceId: "decision" }));
  });

  it("keeps future promises and inactive ownership waiting without activating AI", async () => {
    const promisedAt = new Date(Date.now() + 86_400_000);
    mocks.lead.mockResolvedValue({ ...lead(), nextActionAt: promisedAt });
    expect(await decideFollowUpAttempt("workspace", "lead", "attempt")).toMatchObject({
      decision: "WAIT", factors: { scheduledFollowUpAt: promisedAt.toISOString() }
    });
    mocks.lead.mockResolvedValue({ ...lead(), automationOwnershipState: "HUMAN_MANAGED" });
    expect(await decideFollowUpAttempt("workspace", "lead", "attempt")).toMatchObject({ decision: "WAIT", guardrailCode: "OWNERSHIP_BLOCKED" });
    expect(mocks.human).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("ignores automated inbound metadata as engagement", async () => {
    mocks.lead.mockResolvedValue(lead([message("pricing complaint", "PROSPECT", past, {
      inboundClassification: { version: 1, kind: "NONMEANINGFUL", reason: "AUTO_REPLY" }
    })]));
    expect(await decideFollowUpAttempt("workspace", "lead", "attempt")).toMatchObject({ decision: "FOLLOW_UP" });
  });

  it.each(["PHONE", "WHATSAPP", "EMAIL", "invalid", null])("seeds valid contact preference %s only on initial intelligence creation", async (preferredChannel) => {
    const current = lead();
    mocks.lead.mockResolvedValue({ ...current, contact: { ...current.contact, preferredChannel } });
    await refreshLeadIntelligence({ id: "actor", activeWorkspaceId: "workspace" } as AuthenticatedUser, "lead");
    expect(mocks.upsert.mock.calls[0]?.[0].create.preferredChannel).toBe(
      preferredChannel === "PHONE" || preferredChannel === "WHATSAPP" ? preferredChannel : "EMAIL"
    );
    expect(mocks.upsert.mock.calls[0]?.[0].update).not.toHaveProperty("preferredChannel");
  });
});

describe("document chunking", () => {
  it("preserves long paragraphs and text beyond 250 chunks", () => {
    const content = `${"a".repeat(260 * 1200)}\n\nLast paragraph with the final evidence.`;
    const chunks = splitDocument(content);
    expect(chunks.join("")).toBe(content);
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 1200)).toBe(true);
    expect(chunks.at(-1)).toContain("final evidence");
    expect(splitDocument(" \n\n ")).toEqual([]);
  });
});
