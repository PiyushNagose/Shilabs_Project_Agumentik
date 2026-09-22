import type { Request, Response } from "express";
import type { SalesActionDashboardDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import { getSalesActionDashboard } from "./action-dashboard.service.js";

export async function getSalesActionDashboardController(
  request: Request,
  response: Response<SalesActionDashboardDto>
): Promise<void> {
  response.status(200).json(await getSalesActionDashboard(getRequiredUser(request)));
}
