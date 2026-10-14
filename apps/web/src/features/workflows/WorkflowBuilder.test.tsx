/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDetailDto } from "@shilabs/shared-types";
import { WorkflowBuilder } from "./WorkflowBuilder.js";

const createdAt = "2026-10-13T10:00:00.000Z";
const workflow: WorkflowDetailDto = {
  id: "workflow_1",
  key: "lead-follow-up",
  name: "Lead follow-up",
  description: "Governed lead follow-up",
  status: "PUBLISHED",
  currentVersionId: "workflow_version_1",
  draftVersionId: null,
  createdByUserId: "user_1",
  createdAt,
  updatedAt: createdAt,
  currentVersion: {
    id: "workflow_version_1",
    workflowId: "workflow_1",
    version: 1,
    definition: {
      schemaVersion: 1,
      kind: "WORKFLOW",
      nodes: [
        {
          id: "trigger",
          type: "TRIGGER",
          label: "Lead updated",
          position: { x: 240, y: 40 },
          config: { event: "LEAD_UPDATED" }
        },
        {
          id: "condition",
          type: "CONDITION",
          label: "Automation allowed?",
          position: { x: 240, y: 200 },
          config: { field: "ownershipState", value: "AI_ACTIVE" }
        },
        {
          id: "end",
          type: "END",
          label: "Stop",
          position: { x: 500, y: 380 },
          config: { outcome: "COMPLETED" }
        }
      ],
      edges: [
        { id: "edge_1", source: "trigger", target: "condition", branch: null },
        { id: "edge_2", source: "condition", target: "end", branch: "false" }
      ]
    },
    policyConfig: { service: "CRM", cadenceMinutes: [60, 1440] },
    publishedAt: createdAt,
    publishedByUserId: "user_1",
    createdAt
  },
  draftVersion: null,
  versions: [],
  executionCount: 2,
  runningCount: 0,
  lastExecutedAt: createdAt,
  executions: []
};

describe("WorkflowBuilder", () => {
  afterEach(cleanup);

  it("renders persisted nodes, branching, the complete palette and publishing controls", () => {
    const { container } = render(
      <WorkflowBuilder accessToken="token" workflow={workflow} canManage onChanged={vi.fn()} />
    );

    expect(screen.getByLabelText("Workflow builder")).toBeTruthy();
    expect(screen.getByText("Lead updated")).toBeTruthy();
    expect(screen.getAllByText("Automation allowed?").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".composer-connectors path")).toHaveLength(2);
    const conditionNode = screen.getAllByText("Automation allowed?")[0];
    expect(conditionNode).toBeDefined();
    if (conditionNode) fireEvent.click(conditionNode);
    expect(screen.getByDisplayValue("false")).toBeTruthy();
    expect(screen.getByText("Node settings")).toBeTruthy();

    const palette = screen.getByLabelText("Workflow nodes");
    for (const label of [
      "Trigger",
      "Condition",
      "If / Else",
      "Wait",
      "Action",
      "Agent",
      "Handoff",
      "End"
    ]) {
      expect(within(palette).getByText(label).closest("button")).toBeTruthy();
    }

    for (const action of ["Save draft", "Validate", "Preview", "Publish"]) {
      expect(screen.getByRole("button", { name: new RegExp(action, "i") })).toBeTruthy();
    }
  });
});
