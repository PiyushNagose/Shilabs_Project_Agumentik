import type { Request, Response } from "express";
import type { MeetingRequestDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import {
  confirmMeetingRequest,
  createMeetingRequest,
  listMeetingRequests
} from "./meeting.service.js";
import type {
  ConfirmMeetingRequestInput,
  CreateMeetingRequestInput,
  ListMeetingRequestsQuery
} from "./meeting.schemas.js";

export async function createMeetingRequestController(
  request: Request,
  response: Response<MeetingRequestDto>
): Promise<void> {
  response
    .status(201)
    .json(
      await createMeetingRequest(
        getRequiredUser(request),
        request.body as CreateMeetingRequestInput
      )
    );
}

export async function listMeetingRequestsController(
  request: Request,
  response: Response<MeetingRequestDto[]>
): Promise<void> {
  response
    .status(200)
    .json(
      await listMeetingRequests(
        getRequiredUser(request),
        request.validatedQuery as ListMeetingRequestsQuery
      )
    );
}

export async function confirmMeetingRequestController(
  request: Request<{ id: string }>,
  response: Response<MeetingRequestDto>
): Promise<void> {
  response
    .status(200)
    .json(
      await confirmMeetingRequest(
        getRequiredUser(request),
        request.params.id,
        request.body as ConfirmMeetingRequestInput
      )
    );
}
