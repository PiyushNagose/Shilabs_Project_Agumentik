/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FollowUpPolicyDto } from "@shilabs/shared-types";
import { FollowUpPoliciesSection } from "./FollowUpPoliciesSection.js";
import { createFollowUpPolicy, updateFollowUpPolicy } from "../../services/api-client.js";

const state = vi.hoisted(() => ({ policies: [] as FollowUpPolicyDto[], reload: vi.fn() }));
vi.mock("../../hooks/usePersistedResource.js", () => ({
  usePersistedResource: () => ({
    data: state.policies,
    loading: false,
    error: null,
    reload: state.reload
  })
}));
vi.mock("../../services/api-client.js", () => ({
  apiErrorMessage: (_cause: unknown, fallback: string) => fallback,
  createFollowUpPolicy: vi.fn().mockResolvedValue({}),
  updateFollowUpPolicy: vi.fn().mockResolvedValue({}),
  deleteFollowUpPolicy: vi.fn(),
  listFollowUpPolicies: vi.fn(),
  listUsers: vi
    .fn()
    .mockResolvedValue([
      { id: "manager-1", firstName: "Mira", lastName: "Sales", status: "ACTIVE" }
    ])
}));
vi.mock("../../services/api/companies.js", () => ({
  listCompanies: vi.fn().mockResolvedValue([{ id: "company-1", name: "Acme" }])
}));
vi.mock("../../services/api/deals.js", () => ({
  listPipelines: vi.fn().mockResolvedValue([
    {
      id: "pipeline-1",
      name: "Sales",
      status: "ACTIVE",
      stages: [{ id: "stage-1", label: "Proposal", status: "ACTIVE" }]
    }
  ])
}));

describe("FollowUpPoliciesSection", () => {
  afterEach(() => {
    cleanup();
    state.policies = [];
    vi.clearAllMocks();
  });

  it("saves personality with real company, manager and stage selector IDs", async () => {
    render(<FollowUpPoliciesSection accessToken="token" />);
    fireEvent.click(screen.getByRole("button", { name: "New schedule" }));
    await screen.findByRole("option", { name: "Acme", hidden: true });
    fireEvent.change(screen.getByLabelText("Schedule name"), { target: { value: "Acme SEO" } });
    fireEvent.change(screen.getByLabelText("Company", { selector: "select" }), {
      target: { value: "company-1" }
    });
    fireEvent.change(screen.getByLabelText("Manager", { selector: "select" }), {
      target: { value: "manager-1" }
    });
    fireEvent.change(screen.getByLabelText("Pipeline stage", { selector: "select" }), {
      target: { value: "stage-1" }
    });
    fireEvent.change(screen.getByLabelText("Communication personality"), {
      target: { value: "Warm, brief, no jargon" }
    });
    fireEvent.change(screen.getByLabelText("Selection priority"), { target: { value: "10" } });
    expect(screen.getByLabelText("Follow-up days")).toHaveProperty("value", "1, 5, 9");
    fireEvent.change(screen.getByLabelText("Follow-up days"), { target: { value: "8, 2, 5, 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() =>
      expect(createFollowUpPolicy).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({
          companyId: "company-1",
          managerId: "manager-1",
          pipelineStageId: "stage-1",
          communicationPersonality: "Warm, brief, no jargon",
          selectionPriority: 10,
          cadenceDays: [0, 2, 5, 8]
        })
      )
    );
  });

  it("loads an existing personality and lets the manager clear it", async () => {
    state.policies = [
      {
        id: "policy-1",
        workspaceId: "workspace-1",
        name: "Default",
        enabled: true,
        isDefault: true,
        selectionPriority: 0,
        cadenceDays: [0, 1, 5, 9],
        communicationPersonality: "Brief and professional",
        service: null,
        leadType: null,
        source: null,
        country: null,
        priority: null,
        managerId: null,
        campaign: null,
        pipelineStageId: null,
        createdAt: "2026-10-01",
        updatedAt: "2026-10-01"
      }
    ];
    render(<FollowUpPoliciesSection accessToken="token" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Default" }));
    expect(screen.getByLabelText("Follow-up days")).toHaveProperty("value", "1, 5, 9");
    expect(screen.getByText("Follow up on days 1, 5, 9")).toBeTruthy();
    expect(screen.getByLabelText("Communication personality")).toHaveProperty(
      "value",
      "Brief and professional"
    );
    fireEvent.change(screen.getByLabelText("Communication personality"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() =>
      expect(updateFollowUpPolicy).toHaveBeenCalledWith(
        "token",
        "policy-1",
        expect.objectContaining({ communicationPersonality: null, cadenceDays: [0, 1, 5, 9] })
      )
    );
  });

  it.each([
    "0, 1, 5",
    "",
    "1,",
    "-1, 5",
    "1.5, 5",
    "1, nope, 5",
    "366",
    "1,2,3,4,5,6,7,8,9,10,11,12"
  ])("rejects invalid follow-up days %j without saving", async (value) => {
    render(<FollowUpPoliciesSection accessToken="token" />);
    fireEvent.click(screen.getByRole("button", { name: "New schedule" }));
    await screen.findByRole("option", { name: "Acme", hidden: true });
    fireEvent.change(screen.getByLabelText("Schedule name"), {
      target: { value: "Invalid schedule" }
    });
    fireEvent.change(screen.getByLabelText("Follow-up days"), { target: { value } });
    const form = document.getElementById("follow-up-policy-form");
    if (!form) throw new Error("Schedule form is missing");
    fireEvent.submit(form);
    expect(screen.getByRole("alert").textContent).toContain("positive whole day numbers");
    expect(createFollowUpPolicy).not.toHaveBeenCalled();
    expect(updateFollowUpPolicy).not.toHaveBeenCalled();
  });
});
