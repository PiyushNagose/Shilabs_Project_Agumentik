import type { Request, Response } from "express";
import type { ZohoLeadContactSyncDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../../middleware/auth.middleware.js";
import { syncZohoLeadContacts } from "./zoho-bigin-sync.service.js";

export async function syncZohoLeadContactsController(
  request: Request,
  response: Response<ZohoLeadContactSyncDto>
): Promise<void> {
  response.status(200).json(await syncZohoLeadContacts({ actor: getRequiredUser(request) }));
}
