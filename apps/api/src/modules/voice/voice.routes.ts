import express, { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createManualVoiceCallController,
  getTwilioTestCallTwimlController,
  getVoiceHealthController,
  ingestTwilioRecordingWebhookController,
  ingestTwilioStatusWebhookController
} from "./voice.controller.js";
import {
  manualVoiceCallSchema,
  twilioRecordingWebhookSchema,
  twilioStatusWebhookSchema
} from "./voice.schemas.js";

export const voiceRoutes = Router();

const twilioWebhookParser = express.urlencoded({
  extended: false,
  verify: (request, _response, buffer) => {
    (request as express.Request & { rawBody?: string }).rawBody = buffer.toString("utf8");
  }
});

voiceRoutes.get(
  "/health",
  requireAuth,
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(getVoiceHealthController)
);

voiceRoutes.post(
  "/manual-test-call",
  requireAuth,
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateBody(manualVoiceCallSchema),
  asyncHandler(createManualVoiceCallController)
);

voiceRoutes.post(
  "/twilio/status",
  twilioWebhookParser,
  validateBody(twilioStatusWebhookSchema),
  asyncHandler(ingestTwilioStatusWebhookController)
);

voiceRoutes.post(
  "/twilio/recording",
  twilioWebhookParser,
  validateBody(twilioRecordingWebhookSchema),
  asyncHandler(ingestTwilioRecordingWebhookController)
);

voiceRoutes.get("/twilio/twiml/test-call", getTwilioTestCallTwimlController);
