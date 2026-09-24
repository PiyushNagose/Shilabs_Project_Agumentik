import type { Request, Response } from "express";
import type { BriefingRunDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import {
  generateLeadBriefing,
  generateMeetingBriefing,
  listBriefings
} from "./briefing.service.js";
import type { GenerateBriefingInput, ListBriefingsQuery } from "./briefing.schemas.js";

export async function listBriefingsController(
  request: Request,
  response: Response<BriefingRunDto[]>
): Promise<void> {
  response
    .status(200)
    .json(
      await listBriefings(
        getRequiredUser(request),
        request.validatedQuery as ListBriefingsQuery
      )
    );
}

export async function generateLeadBriefingController(
  request: Request<{ leadId: string }, BriefingRunDto, GenerateBriefingInput>,
  response: Response<BriefingRunDto>
): Promise<void> {
  response
    .status(201)
    .json(await generateLeadBriefing(getRequiredUser(request), request.params.leadId, request.body));
}

export async function generateMeetingBriefingController(
  request: Request<{ meetingRequestId: string }, BriefingRunDto, GenerateBriefingInput>,
  response: Response<BriefingRunDto>
): Promise<void> {
  response
    .status(201)
    .json(
      await generateMeetingBriefing(
        getRequiredUser(request),
        request.params.meetingRequestId,
        request.body
      )
    );
}
