import type { ManagerAccountabilityReportDto } from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export function getManagerAccountabilityReport(
  token: string
): Promise<ManagerAccountabilityReportDto> {
  return apiRequest("/api/analytics/accountability", token);
}
