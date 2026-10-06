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
  if (actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER) return {};
  return { OR: [{ ownerId: actor.id }, { ownerId: null }] };
}

export function canAccessLead(actor: AuthenticatedUser, lead: { ownerId: string | null }): boolean {
  if (actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER) return true;
  return lead.ownerId === actor.id || lead.ownerId === null;
}

export function assertCanAccessLead(
  actor: AuthenticatedUser,
  lead: { ownerId: string | null }
): void {
  if (!canAccessLead(actor, lead)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot access this lead");
  }
}

export function assertCanMutateLead(
  actor: AuthenticatedUser,
  lead: { ownerId: string | null }
): void {
  if (actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER) return;
  if (lead.ownerId === actor.id || lead.ownerId === null) return;
  throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot update another salesperson's lead");
}
