import { UserRole, WorkspaceRole } from "@prisma/client";
import type { AuthenticatedUser } from "../auth/auth.types.js";

function legacyWorkspaceRole(role: UserRole): WorkspaceRole {
  if (role === UserRole.ADMIN) return WorkspaceRole.ADMIN;
  if (role === UserRole.SALES_MANAGER) return WorkspaceRole.SALES_MANAGER;
  return WorkspaceRole.SALES_REP;
}

export function activeWorkspaceRole(actor: AuthenticatedUser): WorkspaceRole {
  return actor.activeWorkspaceRole ?? legacyWorkspaceRole(actor.role);
}

export function isWorkspaceAdmin(actor: AuthenticatedUser): boolean {
  const role = activeWorkspaceRole(actor);
  return role === WorkspaceRole.OWNER || role === WorkspaceRole.ADMIN;
}

export function isWorkspaceManager(actor: AuthenticatedUser): boolean {
  const role = activeWorkspaceRole(actor);
  return (
    role === WorkspaceRole.OWNER ||
    role === WorkspaceRole.ADMIN ||
    role === WorkspaceRole.SALES_MANAGER
  );
}

export function canAccessWorkspaceOperations(actor: AuthenticatedUser): boolean {
  const role = activeWorkspaceRole(actor);
  return (
    role === WorkspaceRole.OWNER ||
    role === WorkspaceRole.ADMIN ||
    role === WorkspaceRole.SALES_MANAGER ||
    role === WorkspaceRole.OPERATIONS
  );
}

export function workspaceRoleMatchesLegacyRoles(
  actor: AuthenticatedUser,
  allowedRoles: readonly UserRole[]
): boolean {
  const role = activeWorkspaceRole(actor);
  if (role === WorkspaceRole.OWNER || role === WorkspaceRole.ADMIN)
    return allowedRoles.includes(UserRole.ADMIN);
  if (role === WorkspaceRole.SALES_MANAGER) return allowedRoles.includes(UserRole.SALES_MANAGER);
  if (role === WorkspaceRole.SALES_REP) return allowedRoles.includes(UserRole.SALES_REP);
  return false;
}
