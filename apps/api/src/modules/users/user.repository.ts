import type { Prisma, User } from "@prisma/client";
import { WorkspaceMemberStatus, WorkspaceRole } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

export type UserRecord = Pick<
  User,
  | "id"
  | "email"
  | "passwordHash"
  | "firstName"
  | "lastName"
  | "role"
  | "status"
  | "createdAt"
  | "updatedAt"
>;
export type WorkspaceUserRecord = UserRecord & {
  workspaceMemberships: { role: WorkspaceRole; status: WorkspaceMemberStatus }[];
};

export interface WorkspaceMembershipUpdate {
  role?: WorkspaceRole;
  status?: WorkspaceMemberStatus;
}

export async function listUsers(workspaceId: string): Promise<WorkspaceUserRecord[]> {
  return prisma.user.findMany({
    where: {
      workspaceMemberships: {
        some: { workspaceId, status: { not: WorkspaceMemberStatus.REMOVED } }
      }
    },
    include: {
      workspaceMemberships: { where: { workspaceId }, select: { role: true, status: true } }
    },
    orderBy: [{ createdAt: "asc" }, { email: "asc" }]
  });
}

export async function findWorkspaceUser(
  workspaceId: string,
  id: string
): Promise<WorkspaceUserRecord | null> {
  return prisma.user.findUnique({
    where: {
      id,
      workspaceMemberships: {
        some: { workspaceId, status: { not: WorkspaceMemberStatus.REMOVED } }
      }
    },
    include: {
      workspaceMemberships: { where: { workspaceId }, select: { role: true, status: true } }
    }
  });
}

export async function createWorkspaceUser(
  workspaceId: string,
  invitedById: string,
  data: Prisma.UserCreateInput,
  role: WorkspaceRole
): Promise<WorkspaceUserRecord> {
  return prisma.$transaction(async (transaction) => {
    const user = await transaction.user.create({ data });
    const membership = await transaction.workspaceMember.create({
      data: { workspaceId, userId: user.id, invitedById, role }
    });
    return {
      ...user,
      workspaceMemberships: [{ role: membership.role, status: membership.status }]
    };
  });
}

export async function updateWorkspaceUser(
  workspaceId: string,
  id: string,
  profile: { firstName?: string; lastName?: string },
  membership: WorkspaceMembershipUpdate = {}
): Promise<WorkspaceUserRecord> {
  return prisma.$transaction(async (transaction) => {
    const user =
      profile.firstName !== undefined || profile.lastName !== undefined
        ? await transaction.user.update({ where: { id }, data: profile })
        : await transaction.user.findUniqueOrThrow({ where: { id } });
    if (membership.role !== undefined || membership.status !== undefined) {
      await transaction.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: id } },
        data: membership
      });
    }
    const updatedMembership = await transaction.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId: id } },
      select: { role: true, status: true }
    });
    return { ...user, workspaceMemberships: [updatedMembership] };
  });
}
