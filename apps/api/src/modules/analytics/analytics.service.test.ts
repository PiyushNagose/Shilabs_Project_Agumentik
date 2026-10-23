import { describe, expect, it, vi } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { getAiCommandCenter } from "../lead-intelligence/lead-intelligence.service.js";
import { getSalesActionDashboard } from "../action-dashboard/action-dashboard.service.js";
import { prisma } from "../../shared/prisma.js";
import { getManagerAccountabilityReport } from "./analytics.service.js";

vi.mock("../lead-intelligence/lead-intelligence.service.js", () => ({
  getAiCommandCenter: vi.fn()
}));
vi.mock("../action-dashboard/action-dashboard.service.js", () => ({
  getSalesActionDashboard: vi.fn()
}));
vi.mock("../../shared/prisma.js", () => ({
  prisma: {
    workspaceMember: { findMany: vi.fn() },
    lead: { groupBy: vi.fn() },
    task: { groupBy: vi.fn() },
    outboundEmail: { groupBy: vi.fn() },
    deal: { groupBy: vi.fn() }
  }
}));

const actor = {
  id: "manager-1",
  email: "manager@example.local",
  firstName: "Mira",
  lastName: "Manager",
  role: UserRole.SALES_MANAGER,
  status: UserStatus.ACTIVE,
  activeWorkspaceId: "workspace-1",
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-01T00:00:00.000Z")
};

describe("manager accountability report", () => {
  it("uses canonical persisted KPI and action-dashboard aggregates", async () => {
    vi.mocked(prisma.workspaceMember, { deep: true }).findMany.mockResolvedValueOnce([{
      userId: "rep-1", role: "SALES_REP", user: { firstName: "Ravi", lastName: "Shah" }
    }] as never);
    vi.mocked(prisma.lead, { deep: true }).groupBy
      .mockResolvedValueOnce([{ ownerId: "rep-1", _count: { _all: 4 } }] as never)
      .mockResolvedValueOnce([{ ownerId: "rep-1", _count: { _all: 1 } }] as never);
    vi.mocked(prisma.task, { deep: true }).groupBy
      .mockResolvedValueOnce([{ assignedToUserId: "rep-1", _count: { _all: 2 } }] as never)
      .mockResolvedValueOnce([{ completedByUserId: "rep-1", _count: { _all: 3 } }] as never);
    vi.mocked(prisma.outboundEmail, { deep: true }).groupBy.mockResolvedValueOnce([
      { actorUserId: "rep-1", _count: { _all: 2 } }
    ] as never);
    vi.mocked(prisma.deal, { deep: true }).groupBy.mockResolvedValueOnce([
      { ownerId: "rep-1", _count: { _all: 1 } }
    ] as never);
    vi.mocked(getAiCommandCenter).mockResolvedValue({
      generatedAt: "2026-10-17T10:00:00.000Z",
      metrics: {
        activeLeads: 12,
        humanRequired: 3,
        aiActive: 5,
        hotLeads: 2,
        overdueHumanActions: 4,
        proposalsPending: 1,
        meetingsToday: 2,
        pipelineValue: "200000.00"
      },
      humanSignals: { required: 3, overdue: 4, active: 6 },
      aiSignals: { active: 5, paused: 1, stopped: 2 },
      humanKpis: {
        averageResponseMinutes: 18,
        averageFirstResponseMinutes: 12,
        leadsHandled: 9,
        clientResponses: 7,
        proposalsSent: 3,
        meetingsBooked: 2,
        followUpsCompleted: 8,
        opportunities: 4,
        conversionRate: 25,
        revenue: "50000.00",
        averageDealValue: "50000.00",
        currency: "INR"
      },
      aiKpis: {
        followUpsSent: 10,
        repliesGenerated: 6,
        meetingsGenerated: 1,
        reengagements: 5,
        followUpConversionRate: 20,
        leadsRevived: 2,
        humanInterventions: 3,
        handovers: 2
      },
      recommendations: []
    });
    vi.mocked(getSalesActionDashboard).mockResolvedValue({
      generatedAt: "2026-10-17T10:00:00.000Z",
      pendingProposalApprovals: [],
      negotiationAndTakeoverAlerts: [],
      failuresRequiringAttention: [],
      meetings: { status: "AVAILABLE", items: [], message: "None" },
      actionItems: [],
      summary: {
        pendingProposalApprovals: 2,
        negotiationAndTakeoverAlerts: 1,
        failuresRequiringAttention: 5,
        meetings: 0,
        totalActionItems: 8
      }
    });

    const result = await getManagerAccountabilityReport(actor);

    expect(getAiCommandCenter).toHaveBeenCalledWith(actor);
    expect(getSalesActionDashboard).toHaveBeenCalledWith(actor);
    expect(result.humanKpis).toMatchObject({ leadsHandled: 9, conversionRate: 25 });
    expect(result.aiKpis).toMatchObject({ followUpsSent: 10, handovers: 2 });
    expect(result.team).toMatchObject([{
      name: "Ravi Shah", leadsAssigned: 4, humanNeeded: 1,
      overdueTasks: 2, completedTasks: 3, emailsSent: 2, wonDeals: 1
    }]);
    expect(vi.mocked(prisma.lead, { deep: true }).groupBy.mock.calls[0]?.[0]).toMatchObject({
      where: { workspaceId: "workspace-1" }
    });
    expect(result.attention).toEqual({
      humanRequired: 3,
      overdueHumanActions: 4,
      pendingProposalApprovals: 2,
      automationFailures: 5,
      totalOpenItems: 8
    });
  });
});
