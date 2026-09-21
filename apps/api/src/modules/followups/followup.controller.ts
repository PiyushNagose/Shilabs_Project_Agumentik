import type { Request, Response } from "express";
import type { FollowUpSequenceDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import type { StartFollowUpSequenceInput } from "./followup.schemas.js";
import { startFollowUpSequence } from "./followup.service.js";

export async function startFollowUpSequenceController(
  request: Request<{ leadId: string }, FollowUpSequenceDto, StartFollowUpSequenceInput>,
  response: Response<FollowUpSequenceDto>
): Promise<void> {
  response
    .status(201)
    .json(await startFollowUpSequence(getRequiredUser(request), request.params.leadId, request.body));
}
