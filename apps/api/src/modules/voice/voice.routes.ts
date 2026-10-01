import express, { Router } from "express";
import { UserRole } from "@prisma/client";
import { getApiConfig } from "@shilabs/shared-config";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { createWebhookRateLimiter } from "../../middleware/security.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createManualVoiceCallController,
  getExotelVoicebotStreamUrlController,
  getTwilioTestCallTwimlController,
  getVoiceHealthController,
  ingestExotelStatusWebhookController,
  ingestTwilioRecordingWebhookController,
  ingestTwilioStatusWebhookController
} from "./voice.controller.js";
import {
  exotelStatusWebhookSchema,
  manualVoiceCallSchema,
  twilioRecordingWebhookSchema,
  twilioStatusWebhookSchema
} from "./voice.schemas.js";

export const voiceRoutes = Router();
const apiConfig = getApiConfig();
const webhookRateLimiter = createWebhookRateLimiter(apiConfig);

const twilioWebhookParser = express.urlencoded({
  extended: false,
  limit: apiConfig.webhookBodyLimit,
  verify: (request, _response, buffer) => {
    (request as express.Request & { rawBody?: string }).rawBody = buffer.toString("utf8");
  }
});
const exotelWebhookParser = express.urlencoded({
  extended: false,
  limit: apiConfig.webhookBodyLimit
});
const exotelMultipartWebhookParser = express.raw({
  type: (request) => {
    const contentType = request.headers["content-type"];
    return typeof contentType === "string" && contentType.toLowerCase().startsWith("multipart/form-data");
  },
  limit: apiConfig.webhookBodyLimit
});

function parseMultipartFormData(buffer: Buffer, contentType: string | undefined): Record<string, string> {
  const boundary = /boundary=([^;]+)/iu.exec(contentType ?? "")?.[1]?.trim().replace(/^"|"$/gu, "");
  if (!boundary) return {};
  const raw = buffer.toString("utf8");
  const result: Record<string, string> = {};
  for (const part of raw.split(`--${boundary}`)) {
    const name = /name="([^"]+)"/u.exec(part)?.[1];
    if (!name) continue;
    const valueStart = part.indexOf("\r\n\r\n");
    if (valueStart < 0) continue;
    const value = part
      .slice(valueStart + 4)
      .replace(/\r\n$/u, "")
      .trim();
    result[name] = value;
  }
  return result;
}

const normalizeExotelWebhookBody: express.RequestHandler = (request, _response, next) => {
  if (Buffer.isBuffer(request.body)) {
    request.body = parseMultipartFormData(request.body, request.headers["content-type"]);
  }
  next();
};

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
  webhookRateLimiter,
  twilioWebhookParser,
  validateBody(twilioStatusWebhookSchema),
  asyncHandler(ingestTwilioStatusWebhookController)
);

voiceRoutes.post(
  "/twilio/recording",
  webhookRateLimiter,
  twilioWebhookParser,
  validateBody(twilioRecordingWebhookSchema),
  asyncHandler(ingestTwilioRecordingWebhookController)
);

voiceRoutes.post(
  "/exotel/status",
  webhookRateLimiter,
  exotelMultipartWebhookParser,
  exotelWebhookParser,
  normalizeExotelWebhookBody,
  validateBody(exotelStatusWebhookSchema),
  asyncHandler(ingestExotelStatusWebhookController)
);

voiceRoutes.get(
  "/exotel/voicebot",
  webhookRateLimiter,
  getExotelVoicebotStreamUrlController
);

voiceRoutes.post(
  "/exotel/voicebot",
  webhookRateLimiter,
  exotelWebhookParser,
  getExotelVoicebotStreamUrlController
);

voiceRoutes.get(
  "/twilio/twiml/test-call",
  webhookRateLimiter,
  getTwilioTestCallTwimlController
);
