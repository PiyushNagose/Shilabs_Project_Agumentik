/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDashboardDto, AgentDetailDto, PublicUser } from "@shilabs/shared-types";
import { AgentsWorkspace } from "./AgentsWorkspace.js";

const agent: AgentDetailDto = {
  id: "agent_1",
  key: "proposal",
  name: "Proposal Agent",
  description: "Generates governed proposals.",
  type: "PROPOSAL",
  status: "ACTIVE",
  currentVersionId: "version_1",
  draftVersionId: null,
  createdByUserId: null,
  createdAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:00.000Z",
  currentVersion: {
    id: "version_1",
    agentId: "agent_1",
    version: 1,
    definition: { capability: "proposal", adapter: "proposals", managed: true },
    modelConfig: null,
    toolsConfig: { tools: ["proposal"] },
    knowledgeConfig: null,
    publishedAt: "2026-10-08T10:00:00.000Z",
    publishedByUserId: null,
    createdAt: "2026-10-08T10:00:00.000Z"
  },
  draftVersion: null,
  versions: [],
  executionCount: 1,
  successfulExecutionCount: 1,
  failedExecutionCount: 0,
  successRate: 100,
  lastExecutedAt: "2026-10-08T11:00:00.000Z",
  executions: [
    {
      id: "execution_1",
      agentId: "agent_1",
      versionId: "version_1",
      source: "PROPOSAL_GENERATION",
      sourceEntityType: "ProposalGenerationRun",
      sourceEntityId: "run_1",
      entityType: "LEAD",
      entityId: "lead_1",
      leadId: "lead_1",
      status: "SUCCEEDED",
      startedAt: "2026-10-08T11:00:00.000Z",
      completedAt: "2026-10-08T11:00:01.000Z",
      durationMs: 1000,
      summary: "Proposal generated successfully",
      result: {},
      evaluation: { outcome: "PASSED" },
      correlationId: "run_1"
    }
  ]
};

const dashboard: AgentDashboardDto = {
  agents: [agent],
  summary: {
    totalAgents: 1,
    activeAgents: 1,
    pausedAgents: 0,
    totalExecutions: 1,
    successfulExecutions: 1,
    failedExecutions: 0,
    successRate: 100
  }
};
const admin = {
  id: "user_1",
  email: "admin@example.local",
  firstName: "Admin",
  lastName: "User",
  role: "ADMIN",
  status: "ACTIVE",
  createdAt: agent.createdAt,
  updatedAt: agent.updatedAt
} satisfies PublicUser;
const salesRep = { ...admin, id: "user_2", role: "SALES_REP" } satisfies PublicUser;

vi.mock("../../hooks/usePersistedResource.js", () => ({
  usePersistedResource: ({ scope }: { scope: string }) => ({
    data: scope === "agents" ? dashboard : agent,
    loading: false,
    error: null,
    updatedAt: agent.updatedAt,
    reload: vi.fn()
  })
}));

describe("AgentsWorkspace", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders real KPIs and preserves list navigation into execution detail", () => {
    const onRouteChange = vi.fn();
    const { rerender } = render(
      <AgentsWorkspace
        accessToken="token"
        currentUser={admin}
        initialAgentId={null}
        onRouteChange={onRouteChange}
      />
    );
    expect(screen.getByText("Total agents")).toBeTruthy();
    expect(screen.getByText("Proposal Agent")).toBeTruthy();
    fireEvent.click(screen.getByText("Proposal Agent"));
    expect(onRouteChange).toHaveBeenCalledWith("agent_1");
    rerender(
      <AgentsWorkspace
        accessToken="token"
        currentUser={admin}
        initialAgentId="agent_1"
        onRouteChange={onRouteChange}
      />
    );
    expect(screen.getByText("Proposal generated successfully")).toBeTruthy();
    expect(screen.getByText(/Proposal generation -/)).toBeTruthy();
    expect(screen.queryByText("PROPOSAL_GENERATION")).toBeNull();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getAllByText("Passed").length).toBeGreaterThan(0);
  });

  it("opens the shared Agent Composer with the complete node palette", () => {
    const onRouteChange = vi.fn();
    render(
      <AgentsWorkspace
        accessToken="token"
        currentUser={admin}
        initialAgentId="agent_1"
        onRouteChange={onRouteChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));
    expect(onRouteChange).toHaveBeenCalledWith("agent_1", "composer");
    expect(screen.getByText("Visual behavior")).toBeTruthy();
    const palette = screen.getByLabelText("Composer nodes");
    for (const label of [
      "Trigger",
      "Message",
      "Question",
      "Condition",
      "AI Decision",
      "Action",
      "Integration",
      "Wait",
      "Handoff",
      "End"
    ]) {
      expect(within(palette).getByRole("button", { name: new RegExp(label, "i") })).toBeTruthy();
    }
    expect(screen.getAllByText("Evaluate context").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Action Proposal Agent/i }));
    expect(screen.getAllByLabelText("Action").length).toBeGreaterThan(0);
  });

  it("opens a deep-linked Composer read-only for sales reps", () => {
    render(
      <AgentsWorkspace
        accessToken="token"
        currentUser={salesRep}
        initialAgentId="agent_1"
        initialTab="composer"
        onRouteChange={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "View Composer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
    expect(
      within(screen.getByLabelText("Composer nodes")).getByRole("button", { name: /Trigger/i })
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Preview" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows governed evaluation references without exposing raw run IDs", () => {
    const { rerender } = render(
      <AgentsWorkspace
        accessToken="token"
        currentUser={admin}
        initialAgentId="agent_1"
        initialTab="evaluation"
        onRouteChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Agent capability references")).toBeTruthy();
    expect(screen.getByText("Model")).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
    expect(screen.getByText("Knowledge")).toBeTruthy();
    expect(screen.getByText("Tools")).toBeTruthy();
    expect(screen.getByLabelText("Latest execution trace")).toBeTruthy();
    expect(screen.getByLabelText("Agent evaluation log")).toBeTruthy();
    const evaluationLog = screen.getByLabelText("Agent evaluation log");
    expect(
      within(evaluationLog).getByText("Passed").closest("[data-label]")?.getAttribute("data-label")
    ).toBe("Outcome");
    expect(within(evaluationLog).getByText("1s").getAttribute("data-label")).toBe("Duration");
    expect(screen.queryByText(/run_1/)).toBeNull();

    rerender(
      <AgentsWorkspace
        accessToken="token"
        currentUser={salesRep}
        initialAgentId="agent_1"
        initialTab="evaluation"
        onRouteChange={vi.fn()}
      />
    );

    expect(screen.queryByLabelText("Agent capability references")).toBeNull();
    expect(screen.getByText(/Technical configuration is restricted/)).toBeTruthy();
    expect(screen.queryByText("run_1")).toBeNull();
    expect(screen.getAllByText("Passed").length).toBeGreaterThan(0);
  });

  it("shows an execution's schedule without presenting its creation time as completion", () => {
    const original = agent.executions;
    const first = original[0];
    if (!first) throw new Error("Execution fixture is missing");
    agent.executions = [
      {
        ...first,
        status: "QUEUED",
        completedAt: null,
        actualStartedAt: null,
        durationMs: null,
        nextRunAt: "2026-10-22T05:57:00.000Z",
        summary: "Scheduled discovery follow-up"
      }
    ];
    try {
      render(
        <AgentsWorkspace
          accessToken="token"
          currentUser={admin}
          initialAgentId="agent_1"
          initialTab="evaluation"
          onRouteChange={vi.fn()}
        />
      );
      const log = screen.getByLabelText("Agent evaluation log");
      expect(within(log).queryByText("Completed")).toBeNull();
      expect(within(log).getByText("Scheduled for")).toBeTruthy();
      expect(log.querySelector("time")?.dateTime).toBe("2026-10-22T05:57:00.000Z");
      expect(within(log).queryByText("Passed")).toBeNull();
    } finally {
      agent.executions = original;
    }
  });
});
