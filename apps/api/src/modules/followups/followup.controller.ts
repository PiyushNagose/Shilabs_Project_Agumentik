import type { Request, Response } from "express";
import type { FollowUpSequenceDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import type { StartFollowUpSequenceInput } from "./followup.schemas.js";
import {
  accelerateFollowUpSequenceForE2E,
  listFollowUpSequencesForLead,
  startFollowUpSequence
} from "./followup.service.js";

export async function listFollowUpSequencesForLeadController(
  request: Request<{ leadId: string }>,
  response: Response<FollowUpSequenceDto[]>
): Promise<void> {
  response.status(200).json(await listFollowUpSequencesForLead(request.params.leadId));
}

export async function startFollowUpSequenceController(
  request: Request<{ leadId: string }, FollowUpSequenceDto, StartFollowUpSequenceInput>,
  response: Response<FollowUpSequenceDto>
): Promise<void> {
  response
    .status(201)
    .json(await startFollowUpSequence(getRequiredUser(request), request.params.leadId, request.body));
}

export async function accelerateFollowUpSequenceForE2EController(
  request: Request<{ sequenceId: string }>,
  response: Response<FollowUpSequenceDto>
): Promise<void> {
  response
    .status(200)
    .json(await accelerateFollowUpSequenceForE2E(getRequiredUser(request), request.params.sequenceId));
}
