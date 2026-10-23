import type { Request, Response } from "express";
import type { ManagerAccountabilityReportDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import { getManagerAccountabilityReport } from "./analytics.service.js";

export async function getManagerAccountabilityReportController(
  request: Request,
  response: Response<ManagerAccountabilityReportDto>
): Promise<void> {
  response.status(200).json(await getManagerAccountabilityReport(getRequiredUser(request)));
}
