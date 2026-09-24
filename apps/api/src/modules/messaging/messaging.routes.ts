import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import {
  getMessagingHealthController,
  ingestMetaWhatsAppWebhookController,
  verifyMetaWhatsAppWebhookController
} from "./messaging.controller.js";

export const messagingRoutes = Router();

messagingRoutes.get(
  "/health",
  requireAuth,
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(getMessagingHealthController)
);

messagingRoutes.get("/meta/webhook", verifyMetaWhatsAppWebhookController);
messagingRoutes.post("/meta/webhook", asyncHandler(ingestMetaWhatsAppWebhookController));
