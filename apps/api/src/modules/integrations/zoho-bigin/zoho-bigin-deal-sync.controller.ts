import type { Request, Response } from "express";
import type { ZohoDealSyncDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../../middleware/auth.middleware.js";
import { syncZohoDeals } from "./zoho-bigin-deal-sync.service.js";

export async function syncZohoDealsController(
  request: Request,
  response: Response<ZohoDealSyncDto>
): Promise<void> {
  response.status(200).json(await syncZohoDeals({ actor: getRequiredUser(request) }));
}
