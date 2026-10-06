import type { Company, Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

export type CompanyRecord = Pick<
  Company,
  | "id"
  | "name"
  | "website"
  | "normalizedWebsite"
  | "industry"
  | "location"
  | "employeeRange"
  | "notes"
  | "createdAt"
  | "updatedAt"
>;

export async function listCompanies(
  where: Prisma.CompanyWhereInput = {}
): Promise<CompanyRecord[]> {
  return prisma.company.findMany({
    where,
    orderBy: [{ name: "asc" }, { createdAt: "asc" }]
  });
}

export async function findCompanyById(id: string): Promise<CompanyRecord | null> {
  return prisma.company.findUnique({
    where: { id }
  });
}

export async function findCompanyByNormalizedWebsite(
  normalizedWebsite: string
): Promise<CompanyRecord | null> {
  return prisma.company.findUnique({
    where: { normalizedWebsite }
  });
}

export async function createCompany(data: Prisma.CompanyCreateInput): Promise<CompanyRecord> {
  return prisma.company.create({ data });
}

export async function updateCompany(
  id: string,
  data: Prisma.CompanyUpdateInput
): Promise<CompanyRecord> {
  return prisma.company.update({
    where: { id },
    data
  });
}
