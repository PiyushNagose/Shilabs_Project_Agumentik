import type { CompanyDto } from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export function listCompanies(accessToken: string): Promise<CompanyDto[]> {
  return apiRequest<CompanyDto[]>("/api/companies", accessToken);
}
