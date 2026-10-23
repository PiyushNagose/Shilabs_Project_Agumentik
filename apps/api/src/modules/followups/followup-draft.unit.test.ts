import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attempt: vi.fn(), decision: vi.fn(),
  generate: vi.fn<(input: { leadContext: string }) => Promise<{ body: string; requiresHumanReview: boolean }>>(),
  query: vi.fn<(input: { strings: readonly string[] }) => Promise<unknown[]>>(),
  messages: vi.fn(), activities: vi.fn()
}));
vi.mock("../../shared/prisma.js", () => ({ prisma: {
  followUpAttempt: { findFirst: mocks.attempt },
  message: { findMany: mocks.messages }, activity: { findMany: mocks.activities },
  $queryRaw: mocks.query
} }));
vi.mock("../lead-intelligence/lead-intelligence.service.js", () => ({ decideFollowUpAttempt: mocks.decision }));
vi.mock("../agents/agent.service.js", () => ({ assertAgentCapabilityActive: vi.fn() }));
vi.mock("../ai/ai.factory.js", () => ({ createAIProvider: () => ({ generateFollowUp: mocks.generate }) }));
vi.mock("../knowledge-base/knowledge-base.service.js", () => ({ listApprovedKnowledge: () => Promise.resolve([]) }));
vi.mock("../leads/lead-automation-ownership.service.js", () => ({ requireHumanActionInTransaction: vi.fn() }));
vi.mock("../realtime/realtime.service.js", () => ({ publishRealtimeEvent: vi.fn() }));
vi.mock("./followup.service.js", () => ({ assertSafeFollowUpDraft: vi.fn() }));
vi.mock("./followup-policy.service.js", () => ({ resolveFollowUpCommunicationPersonality: () => Promise.resolve("PROFESSIONAL") }));

import { prepareFollowUpDraft } from "./followup-draft.service.js";

const past = new Date("2026-01-01T00:00:00Z");
function attempt() {
  return {
    id: "attempt", subject: "Follow-up", status: "SCHEDULED", stepIndex: 0, scheduledAt: past,
    sequence: { status: "ACTIVE", createdAt: past, cadenceDays: [0], cadenceMode: "PRODUCTION_DAYS" },
    lead: {
      id: "lead", workspaceId: "workspace", automationOwnershipState: "AI_ACTIVE", status: "NEW",
      contact: { firstName: "Client", lastName: "Name", doNotContact: false },
      company: { name: "Client company" }, stage: { label: "Discovery" },
      intelligence: null, proposals: [], meetingRequests: [], requirement: "Approval routing"
    }
  };
}

describe("send-time draft preparation without database access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.attempt.mockResolvedValue(attempt());
    mocks.decision.mockResolvedValue({
      id: "decision", decision: "FOLLOW_UP", reason: "Address approval routing", nextObjective: "Confirm scope",
      factors: { followUpAttemptId: "attempt", adaptation: "Ask one question" },
      evidence: [{ sourceId: "lead:lead", quote: "Approval routing" }]
    });
    mocks.messages.mockResolvedValue([]);
    mocks.activities.mockResolvedValue([]);
    mocks.query.mockResolvedValue([{ documentId: "document", title: "Scope", kind: "OTHER", content: "Approval routing details" }]);
    mocks.generate.mockResolvedValue({ body: "Which approval steps matter most?", requiresHumanReview: false });
  });

  it("passes the persisted decision and ranked document evidence into generation", async () => {
    expect(await prepareFollowUpDraft("workspace", "attempt")).toMatchObject({ textBody: "Which approval steps matter most?" });
    expect(mocks.decision).toHaveBeenCalledWith("workspace", "lead", "attempt");
    const context: unknown = JSON.parse(mocks.generate.mock.calls[0]?.[0].leadContext ?? "null");
    expect(context).toMatchObject({
      followUpDecision: { id: "decision", factors: { adaptation: "Ask one question" } },
      approvedLeadDocuments: [{ id: "document", evidence: ["Approval routing details"] }]
    });
    expect(mocks.query.mock.calls[0]?.[0].strings.join(" ")).toContain("ts_rank_cd");
  });

  it("prevents generation when the evaluator escalates", async () => {
    mocks.decision.mockResolvedValue({ decision: "ESCALATE", reason: "Pricing requires human review", factors: {} });
    await expect(prepareFollowUpDraft("workspace", "attempt")).rejects.toThrow("Pricing requires human review");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("returns the promised date when it changes during generation", async () => {
    const current = attempt();
    const promisedAt = new Date(Date.now() + 86_400_000);
    mocks.generate.mockImplementation(() => {
      mocks.attempt.mockResolvedValue({ ...current, lead: { ...current.lead, nextActionAt: promisedAt } });
      return Promise.resolve({ body: "Which approval steps matter most?", requiresHumanReview: false });
    });
    expect(await prepareFollowUpDraft("workspace", "attempt")).toEqual({ waitUntil: promisedAt.toISOString() });
  });
});
