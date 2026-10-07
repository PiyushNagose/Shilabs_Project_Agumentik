import { Prisma, WorkspaceMemberStatus, WorkspaceRole } from "@prisma/client";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";

export interface WorkspaceContext {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  memberId: string;
}

const legacyRoleMap: Record<string, WorkspaceRole> = {
  ADMIN: WorkspaceRole.ADMIN,
  SALES_MANAGER: WorkspaceRole.SALES_MANAGER,
  SALES_REP: WorkspaceRole.SALES_REP
};

export async function resolveWorkspaceContext(userId: string, requestedWorkspaceId?: string): Promise<WorkspaceContext> {
  const membership = await prisma.workspaceMember.findFirst({
    where: {
      userId,
      status: WorkspaceMemberStatus.ACTIVE,
      workspaceId: requestedWorkspaceId
    },
    include: { workspace: true },
    orderBy: { joinedAt: "asc" }
  });

  if (requestedWorkspaceId && !membership) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "You are not a member of this workspace");
  }

  let selected = membership ?? await prisma.workspaceMember.findFirst({
    where: { userId, status: WorkspaceMemberStatus.ACTIVE },
    include: { workspace: true },
    orderBy: { joinedAt: "asc" }
  });

  if (!selected) {
    if (requestedWorkspaceId) {
      throw new AppError(403, "AUTHORIZATION_ERROR", "No active workspace membership exists");
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const workspace = await prisma.workspace.upsert({
      where: { slug: "default" },
      create: { name: "Default Workspace", slug: "default", status: "ACTIVE" },
      update: {}
    });
    selected = await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
      create: {
        workspaceId: workspace.id,
        userId,
        role: legacyRoleMap[user?.role ?? ""] ?? WorkspaceRole.VIEWER,
        status: WorkspaceMemberStatus.ACTIVE
      },
      update: { status: WorkspaceMemberStatus.ACTIVE }
    }).then((member) => ({ ...member, workspace }));
  }

  if (!selected) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "No active workspace membership exists");
  }

  return {
    workspaceId: selected.workspaceId,
    workspaceName: selected.workspace.name,
    role: selected.role,
    memberId: selected.id
  };
}

export async function bootstrapDefaultWorkspace(): Promise<void> {
  const users = await prisma.user.findMany({ select: { id: true, role: true } });
  if (users.length === 0) return;

  const workspace = await prisma.workspace.upsert({
    where: { slug: "default" },
    create: { name: "Default Workspace", slug: "default", status: "ACTIVE" },
    update: {}
  });

  await prisma.$transaction(
    users.map((user) => prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      create: {
        workspaceId: workspace.id,
        userId: user.id,
        role: legacyRoleMap[user.role] ?? WorkspaceRole.VIEWER,
        status: WorkspaceMemberStatus.ACTIVE
      },
      update: { status: WorkspaceMemberStatus.ACTIVE }
    }))
  );

  const scopedModels: (keyof typeof prisma)[] = [
    "company", "contact", "pipelineStage", "lead", "deal", "activity", "auditEvent",
    "conversation", "internalNotification", "meetingRequest", "proposal", "followUpSequence",
    "callingSequence", "outboundWhatsAppMessage", "message", "integrationAccount",
    "externalRecordMapping", "integrationSyncRun", "domainEventOutbox",
    "voiceCallAttempt", "voiceProviderEvent", "whatsAppProviderEvent", "outboundEmail",
    "emailProviderEvent", "inboundEmail"
  ];
  for (const model of scopedModels) {
    // Prisma delegates are dynamically indexed only during one-time legacy backfill.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const delegate = prisma[model] as { updateMany?: (args: unknown) => Promise<unknown> };
    if (delegate.updateMany) {
      await delegate.updateMany({ where: { workspaceId: null }, data: { workspaceId: workspace.id } });
    }
  }
}

export function workspaceWhere(workspaceId: string): Prisma.StringNullableFilter {
  return { equals: workspaceId };
}
