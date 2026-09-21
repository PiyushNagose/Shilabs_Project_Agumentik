import type { Request, Response } from "express";
import type { ReplyProcessingRunDto } from "@shilabs/shared-types";
import { processInboundReply } from "./reply-processing.service.js";

export async function processInboundReplyController(
  request: Request<{ id: string }>,
  response: Response<ReplyProcessingRunDto>
): Promise<void> {
  response.status(200).json(await processInboundReply(request.params.id));
}
