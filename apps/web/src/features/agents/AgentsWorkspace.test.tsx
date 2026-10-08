/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from "@testing-library/react";
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
  afterEach(() => vi.clearAllMocks());

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
    expect(screen.getByText("Passed")).toBeTruthy();
  });
});
