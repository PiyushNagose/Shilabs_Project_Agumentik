import type { Request, Response } from "express";
import type { OperationsDashboardDto } from "@shilabs/shared-types";
import { getOperationsDashboard } from "./operations.service.js";

export async function getOperationsDashboardController(
  _request: Request,
  response: Response<OperationsDashboardDto>
): Promise<void> {
  response.status(200).json(await getOperationsDashboard());
}
