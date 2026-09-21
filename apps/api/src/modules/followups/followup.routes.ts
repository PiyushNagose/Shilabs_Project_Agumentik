import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { startFollowUpSequenceController } from "./followup.controller.js";
import { startFollowUpSequenceSchema } from "./followup.schemas.js";

export const followUpRoutes = Router();

followUpRoutes.use(requireAuth);
followUpRoutes.post(
  "/leads/:leadId/start",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(startFollowUpSequenceSchema),
  asyncHandler(startFollowUpSequenceController)
);
