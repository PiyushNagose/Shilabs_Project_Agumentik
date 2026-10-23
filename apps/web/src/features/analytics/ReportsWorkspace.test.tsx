/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getManagerAccountabilityReport } from "../../services/api-client.js";
import { ReportsWorkspace } from "./ReportsWorkspace.js";

const subscribe = vi.fn(() => vi.fn());

vi.mock("../realtime/RealtimeProvider.js", () => ({
  useRealtime: () => ({ status: "connected", subscribe })
}));
vi.mock("../../services/api-client.js", () => ({
  getManagerAccountabilityReport: vi.fn()
}));

const report = {
  generatedAt: "2026-10-17T10:00:00.000Z",
  scopeLabel: "Current workspace, all recorded activity",
  team: [{ userId: "manager-1", name: "Mira Manager", role: "SALES_MANAGER", leadsAssigned: 8, humanNeeded: 3, overdueTasks: 2, completedTasks: 7, emailsSent: 5, wonDeals: 1 }],
  attention: {
    humanRequired: 3,
    overdueHumanActions: 2,
    pendingProposalApprovals: 1,
    automationFailures: 4,
    totalOpenItems: 10
  },
  humanKpis: {
    averageResponseMinutes: 15,
    averageFirstResponseMinutes: null,
    leadsHandled: 8,
    clientResponses: 6,
    proposalsSent: 3,
    meetingsBooked: 2,
    followUpsCompleted: 7,
    opportunities: 4,
    conversionRate: 25,
    revenue: "125000.00",
    averageDealValue: "125000.00",
    currency: "INR"
  },
  aiKpis: {
    followUpsSent: 11,
    repliesGenerated: 5,
    meetingsGenerated: 1,
    reengagements: 4,
    followUpConversionRate: 18.5,
    leadsRevived: 2,
    humanInterventions: 3,
    handovers: 2
  }
};

describe("ReportsWorkspace", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders plain-language human and AI KPIs from the report API", async () => {
    vi.mocked(getManagerAccountabilityReport).mockResolvedValue(report);
    render(<ReportsWorkspace accessToken="token" />);

    expect(await screen.findByRole("heading", { name: "Human and AI performance" })).toBeTruthy();
    expect(screen.getByLabelText("Human performance").textContent).toContain(
      "Average response time"
    );
    expect(screen.getByLabelText("Human performance").textContent).toContain("15 min");
    expect(screen.getByLabelText("Human performance").textContent).toContain("Not enough data");
    expect(screen.getByLabelText("AI performance").textContent).toContain("Follow-ups sent");
    expect(screen.getByLabelText("AI performance").textContent).toContain("11");
    expect(screen.getByLabelText("Items needing attention").textContent).toContain(
      "Automation issues"
    );
    expect(screen.getByLabelText("Team responsibility").textContent).toContain("Mira Manager");
  });

  it("refreshes the report on demand", async () => {
    vi.mocked(getManagerAccountabilityReport).mockResolvedValue(report);
    render(<ReportsWorkspace accessToken="token" />);
    await screen.findByRole("heading", { name: "Human and AI performance" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh report" }));
    await waitFor(() => expect(getManagerAccountabilityReport).toHaveBeenCalledTimes(2));
  });
});
