/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadIntelligenceDto, PublicUser } from "@shilabs/shared-types";
import { LeadIntelligencePanel } from "./LeadIntelligencePanel.js";
import { updateLeadIntelligenceControls } from "../../services/api-client.js";

const state = vi.hoisted(() => ({
  data: null as LeadIntelligenceDto | null,
  subscribe: vi.fn(() => () => undefined)
}));
vi.mock("../realtime/RealtimeProvider.js", () => ({
  useRealtime: () => ({ subscribe: state.subscribe })
}));
vi.mock("../../services/api-client.js", () => ({
  getLeadIntelligence: vi.fn(() => Promise.resolve(state.data)),
  updateLeadIntelligenceControls: vi.fn(
    (_token: string, _leadId: string, body: Partial<LeadIntelligenceDto>) => {
      state.data = { ...intelligence(), ...state.data, ...body };
      return Promise.resolve(state.data);
    }
  ),
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
  createLeadIntelligenceDocument: vi.fn(),
  deleteLeadIntelligenceDocument: vi.fn(),
  refreshLeadIntelligence: vi.fn(),
  uploadLeadIntelligenceDocument: vi.fn(),
  decideLeadFollowUp: vi.fn()
}));

const manager: PublicUser = {
  id: "manager-1",
  email: "manager@example.local",
  firstName: "Mira",
  lastName: "Sales",
  role: "SALES_MANAGER",
  status: "ACTIVE",
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01"
};

function intelligence(): LeadIntelligenceDto {
  return {
    id: "intelligence-1",
    leadId: "lead-1",
    summary: null,
    primaryNeed: null,
    objections: [],
    commitments: [],
    nextObjective: null,
    communicationStyle: null,
    healthScore: 50,
    aiControlStatus: "ON",
    followUpMode: "STANDARD",
    humanInterventionRequired: false,
    preferredChannel: "EMAIL",
    customCadenceDays: [],
    contextSnapshot: {},
    evidence: [],
    lastRefreshedAt: "2026-10-01",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    documents: [],
    latestDecision: null
  };
}

async function showPanel(user = manager): Promise<void> {
  render(<LeadIntelligencePanel accessToken="token" currentUser={user} leadId="lead-1" />);
  await screen.findByRole("region", { name: "Lead intelligence" });
}

describe("LeadIntelligencePanel custom cadence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.data = intelligence();
  });
  afterEach(cleanup);

  it.each([{ existing: [] }, { existing: [4, 9] }])(
    "selects Custom with existing days or the positive default: %j",
    async ({ existing }) => {
      state.data = { ...intelligence(), customCadenceDays: existing };
      await showPanel();
      fireEvent.change(screen.getByLabelText("Follow-up mode", { selector: "select" }), {
        target: { value: "CUSTOM" }
      });
      const expected = existing.length > 0 ? existing : [2, 5, 8];
      await waitFor(() =>
        expect(updateLeadIntelligenceControls).toHaveBeenCalledWith("token", "lead-1", {
          followUpMode: "CUSTOM",
          customCadenceDays: expected
        })
      );
      await waitFor(() =>
        expect(screen.getByLabelText("Custom follow-up days")).toHaveProperty(
          "value",
          expected.join(", ")
        )
      );
    }
  );

  it("edits saved positive days and saves a sorted unique custom cadence", async () => {
    state.data = { ...intelligence(), followUpMode: "CUSTOM", customCadenceDays: [3, 7] };
    await showPanel();
    const input = screen.getByLabelText("Custom follow-up days");
    await waitFor(() => expect(input).toHaveProperty("value", "3, 7"));
    expect(screen.getByRole("button", { name: "Save cadence" })).toHaveProperty("disabled", true);
    fireEvent.change(input, { target: { value: "9, 2, 5, 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save cadence" }));
    await waitFor(() =>
      expect(updateLeadIntelligenceControls).toHaveBeenCalledWith("token", "lead-1", {
        followUpMode: "CUSTOM",
        customCadenceDays: [2, 5, 9]
      })
    );
    await waitFor(() => expect(input).toHaveProperty("value", "2, 5, 9"));
  });

  it.each([
    "0, 2",
    "",
    "2,",
    "-1, 5",
    "2.5, 8",
    "2, nope",
    "366",
    Array.from({ length: 21 }, (_, index) => index + 1).join(",")
  ])("rejects invalid custom days %j without an API mutation", async (value) => {
    state.data = { ...intelligence(), followUpMode: "CUSTOM", customCadenceDays: [2, 5, 8] };
    await showPanel();
    fireEvent.change(screen.getByLabelText("Custom follow-up days"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save cadence" }));
    expect(screen.getByText(/positive whole day numbers/)).toBeTruthy();
    expect(updateLeadIntelligenceControls).not.toHaveBeenCalled();
  });

  it("shows saved custom days read-only for a sales representative", async () => {
    state.data = { ...intelligence(), followUpMode: "CUSTOM", customCadenceDays: [2, 5, 8] };
    await showPanel({ ...manager, role: "SALES_REP" });
    expect(screen.getByLabelText("Custom follow-up days")).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Save cadence" })).toBeNull();
    expect(updateLeadIntelligenceControls).not.toHaveBeenCalled();
  });
});
