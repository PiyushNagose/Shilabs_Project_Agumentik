import type { Contact, Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

export type ContactRecord = Pick<
  Contact,
  | "id"
  | "companyId"
  | "firstName"
  | "lastName"
  | "title"
  | "email"
  | "normalizedEmail"
  | "phone"
  | "normalizedPhone"
  | "whatsappId"
  | "source"
  | "preferredChannel"
  | "doNotContact"
  | "createdAt"
  | "updatedAt"
>;

export async function listContacts(): Promise<ContactRecord[]> {
  return prisma.contact.findMany({
    orderBy: [{ createdAt: "asc" }, { lastName: "asc" }]
  });
}

export async function findContactById(id: string): Promise<ContactRecord | null> {
  return prisma.contact.findUnique({
    where: { id }
  });
}

export async function findDuplicateContact(input: {
  companyId: string;
  normalizedEmail?: string | null;
  normalizedPhone?: string | null;
  whatsappId?: string | null;
  excludeContactId?: string;
}): Promise<ContactRecord | null> {
  const duplicateSignals: Prisma.ContactWhereInput[] = [];

  if (input.normalizedEmail) {
    duplicateSignals.push({ normalizedEmail: input.normalizedEmail });
  }

  if (input.normalizedPhone) {
    duplicateSignals.push({ normalizedPhone: input.normalizedPhone });
  }

  if (input.whatsappId) {
    duplicateSignals.push({ whatsappId: input.whatsappId });
  }

  if (duplicateSignals.length === 0) {
    return null;
  }

  return prisma.contact.findFirst({
    where: {
      companyId: input.companyId,
      id: input.excludeContactId ? { not: input.excludeContactId } : undefined,
      OR: duplicateSignals
    }
  });
}

export async function createContact(data: Prisma.ContactCreateInput): Promise<ContactRecord> {
  return prisma.contact.create({ data });
}

export async function updateContact(
  id: string,
  data: Prisma.ContactUpdateInput
): Promise<ContactRecord> {
  return prisma.contact.update({
    where: { id },
    data
  });
}
