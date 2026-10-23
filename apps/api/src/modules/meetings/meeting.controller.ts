import type { Request, Response } from "express";
import type { MeetingRequestDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import {
  cancelMeetingRequest,
  recordMeetingOutcome,
  rescheduleMeetingRequest,
  confirmMeetingRequest,
  createMeetingRequest,
  getMeetingRequest,
  listMeetingRequests
} from "./meeting.service.js";
import type {
  CancelMeetingRequestInput,
  MeetingOutcomeInput,
  RescheduleMeetingInput,
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

export async function getMeetingRequestController(
  request: Request<{ id: string }>,
  response: Response<MeetingRequestDto>
): Promise<void> {
  response.status(200).json(await getMeetingRequest(getRequiredUser(request), request.params.id));
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

export async function cancelMeetingRequestController(
  request: Request<{ id: string }>,
  response: Response<MeetingRequestDto>
): Promise<void> {
  response.status(200).json(await cancelMeetingRequest(
    getRequiredUser(request), request.params.id, request.body as CancelMeetingRequestInput
  ));
}

export async function recordMeetingOutcomeController(request: Request<{ id: string }>, response: Response<MeetingRequestDto>): Promise<void> {
  response.status(200).json(await recordMeetingOutcome(getRequiredUser(request), request.params.id, request.body as MeetingOutcomeInput));
}

export async function rescheduleMeetingRequestController(request: Request<{ id: string }>, response: Response<MeetingRequestDto>): Promise<void> {
  response.status(200).json(await rescheduleMeetingRequest(getRequiredUser(request), request.params.id, request.body as RescheduleMeetingInput));
}
