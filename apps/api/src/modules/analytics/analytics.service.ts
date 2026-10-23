import type { ManagerAccountabilityReportDto } from "@shilabs/shared-types";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { UserStatus, WorkspaceMemberStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { getSalesActionDashboard } from "../action-dashboard/action-dashboard.service.js";
import { getAiCommandCenter } from "../lead-intelligence/lead-intelligence.service.js";

export async function getManagerAccountabilityReport(
  actor: AuthenticatedUser
): Promise<ManagerAccountabilityReportDto> {
  const workspaceId = actor.activeWorkspaceId;
  if (!workspaceId) throw new Error("An active workspace is required");
  const [performance, actions, members] = await Promise.all([
    getAiCommandCenter(actor),
    getSalesActionDashboard(actor),
    prisma.workspaceMember.findMany({
      where: { workspaceId, status: WorkspaceMemberStatus.ACTIVE, user: { status: UserStatus.ACTIVE } },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { joinedAt: "asc" }
    })
  ]);
  const userIds = members.map((member) => member.userId);
  const [assigned, humanNeeded, overdue, completed, sent, won] = userIds.length
    ? await Promise.all([
        prisma.lead.groupBy({
          by: ["ownerId"],
          where: { workspaceId, ownerId: { in: userIds } },
          _count: { _all: true }
        }),
        prisma.lead.groupBy({
          by: ["ownerId"],
          where: {
            workspaceId,
            ownerId: { in: userIds },
            automationOwnershipState: "HUMAN_REQUIRED",
            status: { notIn: ["WON", "LOST", "DISQUALIFIED"] }
          },
          _count: { _all: true }
        }),
        prisma.task.groupBy({
          by: ["assignedToUserId"],
          where: {
            workspaceId,
            assignedToUserId: { in: userIds },
            status: { in: ["OPEN", "IN_PROGRESS"] },
            dueAt: { lt: new Date() }
          },
          _count: { _all: true }
        }),
        prisma.task.groupBy({
          by: ["completedByUserId"],
          where: { workspaceId, completedByUserId: { in: userIds }, status: "COMPLETED" },
          _count: { _all: true }
        }),
        prisma.outboundEmail.groupBy({
          by: ["actorUserId"],
          where: {
            actorUserId: { in: userIds },
            lead: { workspaceId },
            status: "SENT",
            senderType: "USER"
          },
          _count: { _all: true }
        }),
        prisma.deal.groupBy({
          by: ["ownerId"],
          where: { ownerId: { in: userIds }, lead: { workspaceId }, status: "WON" },
          _count: { _all: true }
        })
      ])
    : [[], [], [], [], [], []];
  const countFor = (items: { _count: { _all: number } }[], index: number) =>
    items[index]?._count._all ?? 0;

  return {
    generatedAt: new Date().toISOString(),
    scopeLabel: "Current workspace, all recorded activity",
    humanKpis: performance.humanKpis,
    aiKpis: performance.aiKpis,
    team: members.map((member) => ({
      userId: member.userId,
      name: `${member.user.firstName} ${member.user.lastName}`.trim(),
      role: member.role,
      leadsAssigned: countFor(assigned, assigned.findIndex((item) => item.ownerId === member.userId)),
      humanNeeded: countFor(humanNeeded, humanNeeded.findIndex((item) => item.ownerId === member.userId)),
      overdueTasks: countFor(overdue, overdue.findIndex((item) => item.assignedToUserId === member.userId)),
      completedTasks: countFor(completed, completed.findIndex((item) => item.completedByUserId === member.userId)),
      emailsSent: countFor(sent, sent.findIndex((item) => item.actorUserId === member.userId)),
      wonDeals: countFor(won, won.findIndex((item) => item.ownerId === member.userId))
    })),
    attention: {
      humanRequired: performance.metrics.humanRequired,
      overdueHumanActions: performance.metrics.overdueHumanActions,
      pendingProposalApprovals: actions.summary.pendingProposalApprovals,
      automationFailures: actions.summary.failuresRequiringAttention,
      totalOpenItems: actions.summary.totalActionItems
    }
  };
}
