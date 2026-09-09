import { UserRole } from "@prisma/client";
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
