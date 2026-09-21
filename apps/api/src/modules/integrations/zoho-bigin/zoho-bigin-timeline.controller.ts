import type { Request, Response } from "express";
import type { ZohoTimelineAppendDto } from "@shilabs/shared-types";
import { appendActivityToZohoTimeline } from "./zoho-bigin-timeline.service.js";

export async function appendActivityToZohoTimelineController(
  request: Request<{ activityId: string }>,
  response: Response<ZohoTimelineAppendDto>
): Promise<void> {
  response
    .status(200)
    .json(await appendActivityToZohoTimeline({ activityId: request.params.activityId }));
}
