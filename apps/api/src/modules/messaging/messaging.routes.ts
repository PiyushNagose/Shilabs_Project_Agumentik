import express, { Router } from "express";
import { UserRole } from "@prisma/client";
import { getApiConfig } from "@shilabs/shared-config";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { createWebhookRateLimiter } from "../../middleware/security.middleware.js";
import {
  getMessagingHealthController,
  ingestMetaWhatsAppWebhookController,
  ingestTwilioWhatsAppWebhookController,
  verifyMetaWhatsAppWebhookController
} from "./messaging.controller.js";

export const messagingRoutes = Router();
const webhookRateLimiter = createWebhookRateLimiter(getApiConfig());
const twilioWebhookParser = express.urlencoded({
  extended: false,
  limit: getApiConfig().webhookBodyLimit
});

messagingRoutes.get(
  "/health",
  requireAuth,
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(getMessagingHealthController)
);

messagingRoutes.get("/meta/webhook", webhookRateLimiter, verifyMetaWhatsAppWebhookController);
messagingRoutes.post(
  "/meta/webhook",
  webhookRateLimiter,
  asyncHandler(ingestMetaWhatsAppWebhookController)
);

messagingRoutes.post(
  "/twilio/webhook",
  webhookRateLimiter,
  twilioWebhookParser,
  asyncHandler(ingestTwilioWhatsAppWebhookController)
);
