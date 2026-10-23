import express from "express";
import request from "supertest";
import { UserRole, UserStatus, WorkspaceRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../middleware/error.middleware.js";
import { verifyAccessToken } from "../auth/auth.service.js";
import { resolveWorkspaceContext } from "../workspaces/workspace.service.js";
import { getManagerAccountabilityReport } from "./analytics.service.js";
import { analyticsRoutes } from "./analytics.routes.js";

vi.mock("../auth/auth.service.js", () => ({ verifyAccessToken: vi.fn() }));
vi.mock("../workspaces/workspace.service.js", () => ({ resolveWorkspaceContext: vi.fn() }));
vi.mock("./analytics.service.js", () => ({ getManagerAccountabilityReport: vi.fn() }));

const app = express();
app.use(express.json());
app.use("/api/analytics", analyticsRoutes);
app.use(errorHandler);

function authenticatedUser(role: UserRole) {
  return {
    id: `${role.toLowerCase()}-1`,
    email: `${role.toLowerCase()}@example.local`,
    firstName: "Report",
    lastName: "User",
    role,
    status: UserStatus.ACTIVE,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z")
  };
}

describe("analytics report routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkspaceContext).mockResolvedValue({
      workspaceId: "workspace-1",
      workspaceName: "Sales workspace",
      role: "SALES_MANAGER",
      memberId: "member-1"
    });
    vi.mocked(getManagerAccountabilityReport).mockResolvedValue({
      generatedAt: "2026-10-17T10:00:00.000Z",
      scopeLabel: "Current workspace, all recorded activity",
      team: [],
      humanKpis: {
        averageResponseMinutes: null,
        averageFirstResponseMinutes: null,
        leadsHandled: 0,
        clientResponses: 0,
        proposalsSent: 0,
        meetingsBooked: 0,
        followUpsCompleted: 0,
        opportunities: 0,
        conversionRate: 0,
        revenue: "0.00",
        averageDealValue: "0.00",
        currency: "INR"
      },
      aiKpis: {
        followUpsSent: 0,
        repliesGenerated: 0,
        meetingsGenerated: 0,
        reengagements: 0,
        followUpConversionRate: 0,
        leadsRevived: 0,
        humanInterventions: 0,
        handovers: 0
      },
      attention: {
        humanRequired: 0,
        overdueHumanActions: 0,
        pendingProposalApprovals: 0,
        automationFailures: 0,
        totalOpenItems: 0
      }
    });
  });

  it.each([UserRole.ADMIN, UserRole.SALES_MANAGER])(
    "allows %s access and passes the selected workspace to the report service",
    async (role) => {
      vi.mocked(verifyAccessToken).mockResolvedValue(authenticatedUser(role));
      vi.mocked(resolveWorkspaceContext).mockResolvedValue({
        workspaceId: "workspace-1",
        workspaceName: "Sales workspace",
        role: role === UserRole.ADMIN ? WorkspaceRole.ADMIN : WorkspaceRole.SALES_MANAGER,
        memberId: "member-1"
      });

      await request(app)
        .get("/api/analytics/accountability")
        .set("Authorization", "Bearer valid-token")
        .set("x-workspace-id", "workspace-1")
        .expect(200);

      expect(getManagerAccountabilityReport).toHaveBeenCalledWith(
        expect.objectContaining({ role, activeWorkspaceId: "workspace-1" })
      );
    }
  );

  it("rejects sales representatives", async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue(authenticatedUser(UserRole.SALES_REP));
    vi.mocked(resolveWorkspaceContext).mockResolvedValue({
      workspaceId: "workspace-1",
      workspaceName: "Sales workspace",
      role: WorkspaceRole.SALES_REP,
      memberId: "member-1"
    });

    await request(app)
      .get("/api/analytics/accountability")
      .set("Authorization", "Bearer valid-token")
      .set("x-workspace-id", "workspace-1")
      .expect(403);

    expect(getManagerAccountabilityReport).not.toHaveBeenCalled();
  });
});
