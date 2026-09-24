import type { Request, Response } from "express";
import type { CalendarAvailabilityResultDto, CalendarHealthDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import { getCalendarAvailability, getCalendarHealth } from "./calendar.service.js";
import type { CalendarAvailabilityInput } from "./calendar.schemas.js";

export async function getCalendarHealthController(
  _request: Request,
  response: Response<CalendarHealthDto>
): Promise<void> {
  response.status(200).json(await getCalendarHealth());
}

export async function getCalendarAvailabilityController(
  request: Request,
  response: Response<CalendarAvailabilityResultDto>
): Promise<void> {
  response
    .status(200)
    .json(
      await getCalendarAvailability(
        getRequiredUser(request),
        request.body as CalendarAvailabilityInput
      )
    );
}
