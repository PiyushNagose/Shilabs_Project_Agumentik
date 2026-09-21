import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createEmailSuppressionController,
  getAwsSesHealthController,
  ingestSesFeedbackEventController,
  ingestSesInboundEmailController,
  listEmailSuppressionsController,
  runEmailDeliverabilityScanController,
  validateOutboundEmailPreSendController,
  sendOutboundEmailController
} from "./email.controller.js";
import {
  createEmailSuppressionSchema,
  sendEmailSchema,
  validatePreSendEmailSchema
} from "./email.schemas.js";

export const emailRoutes = Router();

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
emailRoutes.post("/events", asyncHandler(ingestSesFeedbackEventController));
emailRoutes.post("/inbound", asyncHandler(ingestSesInboundEmailController));
