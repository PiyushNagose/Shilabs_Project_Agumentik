import type { Request, Response } from "express";
import type { LeadQualificationDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import { getLead } from "../leads/lead.service.js";
import type { UpdateQualificationInput } from "./qualification.schemas.js";
import {
  getQualification,
  recalculateQualification,
  updateQualification
} from "./qualification.service.js";

export async function getQualificationController(
  request: Request<{ id: string }>,
  response: Response<LeadQualificationDto>
): Promise<void> {
  await getLead(getRequiredUser(request), request.params.id);
  response.status(200).json(await getQualification(request.params.id));
}

export async function updateQualificationController(
  request: Request<{ id: string }, LeadQualificationDto, UpdateQualificationInput>,
  response: Response<LeadQualificationDto>
): Promise<void> {
  response
    .status(200)
    .json(await updateQualification(getRequiredUser(request), request.params.id, request.body));
}

export async function recalculateQualificationController(
  request: Request<{ id: string }>,
  response: Response<LeadQualificationDto>
): Promise<void> {
  await getLead(getRequiredUser(request), request.params.id);
  response.status(200).json(await recalculateQualification(request.params.id));
}
