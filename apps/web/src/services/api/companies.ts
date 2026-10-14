import type { CompanyDto } from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export interface CompanyBody {
  name: string;
  website?: string | null;
  industry?: string | null;
  location?: string | null;
  employeeRange?: string | null;
  notes?: string | null;
}

export function listCompanies(accessToken: string): Promise<CompanyDto[]> {
  return apiRequest<CompanyDto[]>("/api/companies", accessToken);
}

export function createCompany(accessToken: string, body: CompanyBody): Promise<CompanyDto> {
  return apiRequest<CompanyDto>("/api/companies", accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
}
