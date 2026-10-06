import { Prisma, UserRole } from "@prisma/client";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { leadVisibilityWhere } from "../leads/lead.permissions.js";

function hasGlobalCrmAccess(actor: AuthenticatedUser): boolean {
  return actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER;
}

export function companyVisibilityWhere(actor: AuthenticatedUser): Prisma.CompanyWhereInput {
  return hasGlobalCrmAccess(actor) ? {} : { leads: { some: leadVisibilityWhere(actor) } };
}

export function contactVisibilityWhere(actor: AuthenticatedUser): Prisma.ContactWhereInput {
  return hasGlobalCrmAccess(actor) ? {} : { leads: { some: leadVisibilityWhere(actor) } };
}

export async function assertCanAccessCompany(
  actor: AuthenticatedUser,
  companyId: string,
  options: { allowUnlinked?: boolean } = {}
): Promise<void> {
  if (hasGlobalCrmAccess(actor)) return;
  const allowed = await prisma.company.findFirst({
    where: {
      id: companyId,
      OR: [
        { leads: { some: leadVisibilityWhere(actor) } },
        ...(options.allowUnlinked ? [{ leads: { none: {} } }] : [])
      ]
    },
    select: { id: true }
  });
  if (!allowed) throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot access this company");
}

export async function assertCanAccessContact(
  actor: AuthenticatedUser,
  contactId: string,
  options: { allowUnlinked?: boolean } = {}
): Promise<void> {
  if (hasGlobalCrmAccess(actor)) return;
  const allowed = await prisma.contact.findFirst({
    where: {
      id: contactId,
      OR: [
        { leads: { some: leadVisibilityWhere(actor) } },
        ...(options.allowUnlinked ? [{ leads: { none: {} } }] : [])
      ]
    },
    select: { id: true }
  });
  if (!allowed) throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot access this contact");
}
