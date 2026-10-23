import { Prisma, UserRole, UserStatus, WorkspaceMemberStatus, WorkspaceRole } from "@prisma/client";
import type { PublicUser, WorkspaceRoleName } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword, toPublicUser } from "../auth/auth.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { isWorkspaceManager } from "../authorization/workspace-permissions.js";
import type { CreateUserInput, UpdateUserInput, UpdateUserStatusInput } from "./user.schemas.js";
import {
  createWorkspaceUser,
  findWorkspaceUser,
  listUsers as listUserRecords,
  updateWorkspaceUser,
  type WorkspaceUserRecord
} from "./user.repository.js";

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function requireUser(user: WorkspaceUserRecord | null): WorkspaceUserRecord {
  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }

  return user;
}

function requireWorkspace(actor: AuthenticatedUser): string {
  if (!actor.activeWorkspaceId) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "No active workspace is selected");
  }
  return actor.activeWorkspaceId;
}

function legacyUserRole(role: WorkspaceRoleName): UserRole {
  if (role === WorkspaceRole.OWNER || role === WorkspaceRole.ADMIN) return UserRole.ADMIN;
  if (role === WorkspaceRole.SALES_MANAGER) return UserRole.SALES_MANAGER;
  return UserRole.SALES_REP;
}

function isWorkspaceOwner(actor: AuthenticatedUser): boolean {
  return actor.activeWorkspaceRole === WorkspaceRole.OWNER;
}

function assertOwnerRoleChangeAllowed(
  actor: AuthenticatedUser,
  currentRole: WorkspaceRole | undefined,
  nextRole: WorkspaceRole | undefined
): void {
  if (
    (currentRole === WorkspaceRole.OWNER || nextRole === WorkspaceRole.OWNER) &&
    !isWorkspaceOwner(actor)
  ) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Only a workspace owner can manage owners");
  }
}

async function assertNotLastActiveOwner(
  workspaceId: string,
  userId: string,
  currentRole: WorkspaceRole | undefined
): Promise<void> {
  if (currentRole !== WorkspaceRole.OWNER) return;
  const activeOwners = await prisma.workspaceMember.count({
    where: {
      workspaceId,
      role: WorkspaceRole.OWNER,
      status: WorkspaceMemberStatus.ACTIVE
    }
  });
  if (activeOwners <= 1) {
    throw new AppError(409, "CONFLICT", "The last active workspace owner cannot be removed");
  }
}

function toWorkspacePublicUser(user: WorkspaceUserRecord): PublicUser {
  const membership = user.workspaceMemberships[0];
  if (!membership) throw new AppError(500, "INTERNAL_ERROR", "Workspace membership is unavailable");
  return {
    ...toPublicUser(user),
    workspaceRole: membership.role,
    status:
      membership.status === WorkspaceMemberStatus.ACTIVE ? UserStatus.ACTIVE : UserStatus.INACTIVE
  };
}

export async function listUsers(actor: AuthenticatedUser): Promise<PublicUser[]> {
  const users = await listUserRecords(requireWorkspace(actor));
  return users.map(toWorkspacePublicUser);
}

export async function getUser(actor: AuthenticatedUser, userId: string): Promise<PublicUser> {
  if (actor.id !== userId && !isWorkspaceManager(actor)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Insufficient role permissions");
  }
  return toWorkspacePublicUser(
    requireUser(await findWorkspaceUser(requireWorkspace(actor), userId))
  );
}

export async function updateOwnProfile(
  actor: AuthenticatedUser,
  input: { firstName: string; lastName: string }
): Promise<PublicUser> {
  const workspaceId = requireWorkspace(actor);
  if (!(await findWorkspaceUser(workspaceId, actor.id))) {
    throw new AppError(404, "NOT_FOUND", "User not found in this workspace");
  }
  const updated = toWorkspacePublicUser(await updateWorkspaceUser(workspaceId, actor.id, input));
  await publishRealtimeEvent({
    entityType: "workspace",
    action: "USER_PROFILE_UPDATED",
    workspaceId
  });
  return updated;
}

export async function createUser(
  actor: AuthenticatedUser,
  input: CreateUserInput
): Promise<PublicUser> {
  try {
    const workspaceId = requireWorkspace(actor);
    assertOwnerRoleChangeAllowed(actor, undefined, input.role);
    const user = await createWorkspaceUser(
      workspaceId,
      actor.id,
      {
        email: input.email,
        passwordHash: await hashPassword(input.password),
        firstName: input.firstName,
        lastName: input.lastName,
        role: legacyUserRole(input.role)
      },
      input.role
    );

    const created = toWorkspacePublicUser(user);
    await publishRealtimeEvent({
      entityType: "workspace",
      action: "WORKSPACE_USER_ADDED",
      workspaceId
    });
    return created;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, "CONFLICT", "A user with this email already exists");
    }

    throw error;
  }
}

export async function updateUser(
  actor: AuthenticatedUser,
  userId: string,
  input: UpdateUserInput
): Promise<PublicUser> {
  try {
    if (actor.id === userId && input.role && input.role !== actor.activeWorkspaceRole) {
      throw new AppError(409, "CONFLICT", "You cannot change your own role");
    }
    const workspaceId = requireWorkspace(actor);
    const existing = await findWorkspaceUser(workspaceId, userId);
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "User not found in this workspace");
    }
    const currentRole = existing.workspaceMemberships[0]?.role;
    assertOwnerRoleChangeAllowed(actor, currentRole, input.role);
    if (input.role && input.role !== currentRole) {
      await assertNotLastActiveOwner(workspaceId, userId, currentRole);
    }
    const updated = toWorkspacePublicUser(
      await updateWorkspaceUser(
        workspaceId,
        userId,
        {
          firstName: input.firstName,
          lastName: input.lastName
        },
        { role: input.role }
      )
    );
    await publishRealtimeEvent({
      entityType: "workspace",
      action: "WORKSPACE_USER_UPDATED",
      workspaceId
    });
    return updated;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    throw error;
  }
}

export async function updateUserStatus(
  actor: AuthenticatedUser,
  userId: string,
  input: UpdateUserStatusInput
): Promise<PublicUser> {
  try {
    const workspaceId = requireWorkspace(actor);
    const existing = await findWorkspaceUser(workspaceId, userId);
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "User not found in this workspace");
    }
    const currentRole = existing.workspaceMemberships[0]?.role;
    assertOwnerRoleChangeAllowed(actor, currentRole, undefined);
    if (actor.id === userId && input.status === UserStatus.INACTIVE) {
      throw new AppError(409, "CONFLICT", "You cannot suspend your own workspace membership");
    }
    if (input.status === UserStatus.INACTIVE) {
      await assertNotLastActiveOwner(workspaceId, userId, currentRole);
    }
    const updated = toWorkspacePublicUser(
      await updateWorkspaceUser(
        workspaceId,
        userId,
        {},
        {
          status:
            input.status === UserStatus.ACTIVE
              ? WorkspaceMemberStatus.ACTIVE
              : WorkspaceMemberStatus.SUSPENDED
        }
      )
    );
    await publishRealtimeEvent({
      entityType: "workspace",
      action: "WORKSPACE_USER_STATUS_UPDATED",
      workspaceId
    });
    return updated;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    throw error;
  }
}
