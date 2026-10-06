import type { Request, Response } from "express";
import type { ActivityDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import { getLead } from "../leads/lead.service.js";
import { listLeadActivities } from "./activity.service.js";

export async function listLeadActivitiesController(
  request: Request<{ id: string }>,
  response: Response<ActivityDto[]>
): Promise<void> {
  await getLead(getRequiredUser(request), request.params.id);
  response.status(200).json(await listLeadActivities(request.params.id));
}
