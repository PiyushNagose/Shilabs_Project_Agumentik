import { Prisma } from "@prisma/client";
import type { ContactDto } from "@shilabs/shared-types";
import { normalizeEmail, normalizePhone } from "@shilabs/validation";
import { AppError } from "../../shared/errors.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  assertCanAccessCompany,
  assertCanAccessContact,
  contactVisibilityWhere
} from "../authorization/crm-record.permissions.js";
import { findCompanyById } from "../companies/company.repository.js";
import type { CreateContactInput, UpdateContactInput } from "./contact.schemas.js";
import {
  createContact as createContactRecord,
  findContactById,
  findDuplicateContact,
  listContacts as listContactRecords,
  updateContact as updateContactRecord,
  type ContactRecord
} from "./contact.repository.js";

export function toContactDto(contact: ContactRecord): ContactDto {
  return {
    id: contact.id,
    companyId: contact.companyId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    title: contact.title,
    email: contact.email,
    normalizedEmail: contact.normalizedEmail,
    phone: contact.phone,
    normalizedPhone: contact.normalizedPhone,
    whatsappId: contact.whatsappId,
    source: contact.source,
    preferredChannel: contact.preferredChannel,
    doNotContact: contact.doNotContact,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString()
  };
}

function requireContact(contact: ContactRecord | null): ContactRecord {
  if (!contact) {
    throw new AppError(404, "NOT_FOUND", "Contact not found");
  }

  return contact;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function ensureCompanyExists(companyId: string): Promise<void> {
  const company = await findCompanyById(companyId);
  if (!company) {
    throw new AppError(404, "NOT_FOUND", "Company not found");
  }
}

async function ensureContactIsUnique(input: {
  companyId: string;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  whatsappId: string | null;
  excludeContactId?: string;
}): Promise<void> {
  const existing = await findDuplicateContact(input);
  if (existing) {
    throw new AppError(409, "CONFLICT", "A matching contact already exists for this company", {
      contactId: existing.id
    });
  }
}

export async function listContacts(actor: AuthenticatedUser): Promise<ContactDto[]> {
  return (await listContactRecords(contactVisibilityWhere(actor))).map(toContactDto);
}

export async function getContact(actor: AuthenticatedUser, contactId: string): Promise<ContactDto> {
  const contact = requireContact(await findContactById(contactId));
  await assertCanAccessContact(actor, contact.id);
  return toContactDto(contact);
}

export async function createContact(
  actor: AuthenticatedUser,
  input: CreateContactInput
): Promise<ContactDto> {
  await ensureCompanyExists(input.companyId);
  await assertCanAccessCompany(actor, input.companyId, { allowUnlinked: true });
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedPhone = normalizePhone(input.phone);
  const whatsappId = input.whatsappId ?? null;

  await ensureContactIsUnique({
    companyId: input.companyId,
    normalizedEmail,
    normalizedPhone,
    whatsappId
  });

  try {
    return toContactDto(
      await createContactRecord({
        workspaceId: actor.activeWorkspaceId,
        company: { connect: { id: input.companyId } },
        firstName: input.firstName,
        lastName: input.lastName,
        title: input.title ?? null,
        email: input.email ?? null,
        normalizedEmail,
        phone: input.phone ?? null,
        normalizedPhone,
        whatsappId,
        source: input.source ?? null,
        preferredChannel: input.preferredChannel ?? null,
        doNotContact: input.doNotContact ?? false
      })
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, "CONFLICT", "A matching contact already exists for this company");
    }

    throw error;
  }
}

export async function updateContact(
  actor: AuthenticatedUser,
  contactId: string,
  input: UpdateContactInput
): Promise<ContactDto> {
  const existing = requireContact(await findContactById(contactId));
  await assertCanAccessContact(actor, existing.id);
  const normalizedEmail = "email" in input ? normalizeEmail(input.email) : existing.normalizedEmail;
  const normalizedPhone = "phone" in input ? normalizePhone(input.phone) : existing.normalizedPhone;
  const whatsappId = "whatsappId" in input ? (input.whatsappId ?? null) : existing.whatsappId;

  await ensureContactIsUnique({
    companyId: existing.companyId,
    normalizedEmail,
    normalizedPhone,
    whatsappId,
    excludeContactId: contactId
  });

  try {
    return toContactDto(
      await updateContactRecord(contactId, {
        firstName: input.firstName,
        lastName: input.lastName,
        title: "title" in input ? (input.title ?? null) : undefined,
        email: "email" in input ? (input.email ?? null) : undefined,
        normalizedEmail,
        phone: "phone" in input ? (input.phone ?? null) : undefined,
        normalizedPhone,
        whatsappId,
        source: "source" in input ? (input.source ?? null) : undefined,
        preferredChannel:
          "preferredChannel" in input ? (input.preferredChannel ?? null) : undefined,
        doNotContact: input.doNotContact
      })
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new AppError(404, "NOT_FOUND", "Contact not found");
    }

    if (isUniqueConstraintError(error)) {
      throw new AppError(409, "CONFLICT", "A matching contact already exists for this company");
    }

    throw error;
  }
}
