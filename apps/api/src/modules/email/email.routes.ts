import { Router } from "express";
import { UserRole } from "@prisma/client";
import { getApiConfig } from "@shilabs/shared-config";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { createWebhookRateLimiter } from "../../middleware/security.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createEmailSuppressionController,
  getAwsSesHealthController,
  ingestE2ECustomerReplyController,
  ingestSesFeedbackEventController,
  ingestSesInboundEmailController,
  listEmailSuppressionsController,
  runEmailDeliverabilityScanController,
  validateOutboundEmailPreSendController,
  sendOutboundEmailController
} from "./email.controller.js";
import {
  createEmailSuppressionSchema,
  e2eCustomerReplySchema,
  sendEmailSchema,
  validatePreSendEmailSchema
} from "./email.schemas.js";

export const emailRoutes = Router();
const webhookRateLimiter = createWebhookRateLimiter(getApiConfig());

emailRoutes.get(
  "/health",
  requireAuth,
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(getAwsSesHealthController)
);
emailRoutes.post(
  "/pre-send/validate",
  requireAuth,
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(validatePreSendEmailSchema),
  asyncHandler(validateOutboundEmailPreSendController)
);
emailRoutes.get(
  "/suppressions",
  requireAuth,
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(listEmailSuppressionsController)
);
emailRoutes.post(
  "/suppressions",
  requireAuth,
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateBody(createEmailSuppressionSchema),
  asyncHandler(createEmailSuppressionController)
);
emailRoutes.post(
  "/deliverability/scans",
  requireAuth,
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(runEmailDeliverabilityScanController)
);
emailRoutes.post(
  "/send",
  requireAuth,
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(sendEmailSchema),
  asyncHandler(sendOutboundEmailController)
);
emailRoutes.post(
  "/e2e/customer-reply",
  requireAuth,
  requireRole([UserRole.ADMIN]),
  validateBody(e2eCustomerReplySchema),
  asyncHandler(ingestE2ECustomerReplyController)
);
emailRoutes.post("/events", webhookRateLimiter, asyncHandler(ingestSesFeedbackEventController));
emailRoutes.post("/inbound", webhookRateLimiter, asyncHandler(ingestSesInboundEmailController));
