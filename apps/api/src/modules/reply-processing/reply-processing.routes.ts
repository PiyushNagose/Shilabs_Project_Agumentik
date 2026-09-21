import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { processInboundReplyController } from "./reply-processing.controller.js";

export const replyProcessingRoutes = Router();

replyProcessingRoutes.use(requireAuth);
replyProcessingRoutes.post(
  "/inbound-emails/:id/process",
  asyncHandler(processInboundReplyController)
);
