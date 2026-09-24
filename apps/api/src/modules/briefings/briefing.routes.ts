import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  generateLeadBriefingController,
  generateMeetingBriefingController,
  listBriefingsController
} from "./briefing.controller.js";
import { generateBriefingSchema, listBriefingsQuerySchema } from "./briefing.schemas.js";

export const briefingRoutes = Router();

briefingRoutes.use(requireAuth);
briefingRoutes.use(requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]));

briefingRoutes.get("/", validateQuery(listBriefingsQuerySchema), asyncHandler(listBriefingsController));
briefingRoutes.post(
  "/leads/:leadId/generate",
  validateBody(generateBriefingSchema),
  asyncHandler(generateLeadBriefingController)
);
briefingRoutes.post(
  "/meetings/:meetingRequestId/generate",
  validateBody(generateBriefingSchema),
  asyncHandler(generateMeetingBriefingController)
);
