import { UserRole } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";

export function canAssignLead(actor: AuthenticatedUser): boolean {
  return actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER;
}

export function canCreateLeadWithOwner(
  actor: AuthenticatedUser,
  ownerId: string | null | undefined
): boolean {
  return !ownerId || ownerId === actor.id || canAssignLead(actor);
}

export function leadVisibilityWhere(actor: AuthenticatedUser): Prisma.LeadWhereInput {
  const ownership =
    actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER
      ? {}
      : { OR: [{ ownerId: actor.id }, { ownerId: null }] };
  return actor.activeWorkspaceId
    ? { AND: [ownership, { workspaceId: actor.activeWorkspaceId }] }
    : ownership;
}

export function assertLeadWorkspace(actor: AuthenticatedUser, lead: { workspaceId?: string | null }): void {
  if (actor.activeWorkspaceId && lead.workspaceId !== actor.activeWorkspaceId) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Lead belongs to another workspace");
  }
}

export function canAccessLead(actor: AuthenticatedUser, lead: { ownerId: string | null }): boolean {
  if (actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER) return true;
  return lead.ownerId === actor.id || lead.ownerId === null;
}

export function assertCanAccessLead(
  actor: AuthenticatedUser,
  lead: { ownerId: string | null; workspaceId?: string | null }
): void {
  assertLeadWorkspace(actor, lead);
  if (!canAccessLead(actor, lead)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot access this lead");
  }
}

export function assertCanMutateLead(
  actor: AuthenticatedUser,
  lead: { ownerId: string | null; workspaceId?: string | null }
): void {
  assertLeadWorkspace(actor, lead);
  if (actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER) return;
  if (lead.ownerId === actor.id || lead.ownerId === null) return;
  throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot update another salesperson's lead");
}
