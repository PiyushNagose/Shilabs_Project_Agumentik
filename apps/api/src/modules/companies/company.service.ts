import { Prisma } from "@prisma/client";
import type { CompanyDto } from "@shilabs/shared-types";
import { normalizeWebsite } from "@shilabs/validation";
import { AppError } from "../../shared/errors.js";
import type { CreateCompanyInput, UpdateCompanyInput } from "./company.schemas.js";
import {
  createCompany as createCompanyRecord,
  findCompanyById,
  findCompanyByNormalizedWebsite,
  listCompanies as listCompanyRecords,
  updateCompany as updateCompanyRecord,
  type CompanyRecord
} from "./company.repository.js";

export function toCompanyDto(company: CompanyRecord): CompanyDto {
  return {
    id: company.id,
    name: company.name,
    website: company.website,
    normalizedWebsite: company.normalizedWebsite,
    industry: company.industry,
    location: company.location,
    employeeRange: company.employeeRange,
    notes: company.notes,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString()
  };
}

function requireCompany(company: CompanyRecord | null): CompanyRecord {
  if (!company) {
    throw new AppError(404, "NOT_FOUND", "Company not found");
  }

  return company;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function ensureWebsiteIsAvailable(
  normalizedWebsite: string | null,
  currentCompanyId?: string
): Promise<void> {
  if (!normalizedWebsite) {
    return;
  }

  const existing = await findCompanyByNormalizedWebsite(normalizedWebsite);
  if (existing && existing.id !== currentCompanyId) {
    throw new AppError(409, "CONFLICT", "A company with this website already exists", {
      companyId: existing.id
    });
  }
}

export async function listCompanies(): Promise<CompanyDto[]> {
  return (await listCompanyRecords()).map(toCompanyDto);
}

export async function getCompany(companyId: string): Promise<CompanyDto> {
  return toCompanyDto(requireCompany(await findCompanyById(companyId)));
}

export async function createCompany(input: CreateCompanyInput): Promise<CompanyDto> {
  const normalizedWebsite = normalizeWebsite(input.website);
  await ensureWebsiteIsAvailable(normalizedWebsite);

  try {
    return toCompanyDto(
      await createCompanyRecord({
        name: input.name,
        website: input.website ?? null,
        normalizedWebsite,
        industry: input.industry ?? null,
        location: input.location ?? null,
        employeeRange: input.employeeRange ?? null,
        notes: input.notes ?? null
      })
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, "CONFLICT", "A company with this website already exists");
    }

    throw error;
  }
}

export async function updateCompany(
  companyId: string,
  input: UpdateCompanyInput
): Promise<CompanyDto> {
  const existing = requireCompany(await findCompanyById(companyId));
  const normalizedWebsite =
    "website" in input ? normalizeWebsite(input.website) : existing.normalizedWebsite;
  await ensureWebsiteIsAvailable(normalizedWebsite, companyId);

  try {
    return toCompanyDto(
      await updateCompanyRecord(companyId, {
        name: input.name,
        website: "website" in input ? (input.website ?? null) : undefined,
        normalizedWebsite,
        industry: "industry" in input ? (input.industry ?? null) : undefined,
        location: "location" in input ? (input.location ?? null) : undefined,
        employeeRange: "employeeRange" in input ? (input.employeeRange ?? null) : undefined,
        notes: "notes" in input ? (input.notes ?? null) : undefined
      })
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new AppError(404, "NOT_FOUND", "Company not found");
    }

    if (isUniqueConstraintError(error)) {
      throw new AppError(409, "CONFLICT", "A company with this website already exists");
    }

    throw error;
  }
}
