import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  accelerateFollowUpSequenceForE2EController,
  listFollowUpSequencesForLeadController,
  startFollowUpSequenceController
} from "./followup.controller.js";
import { startFollowUpSequenceSchema } from "./followup.schemas.js";

export const followUpRoutes = Router();

followUpRoutes.use(requireAuth);
followUpRoutes.get(
  "/leads/:leadId",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  asyncHandler(listFollowUpSequencesForLeadController)
);
followUpRoutes.post(
  "/leads/:leadId/start",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(startFollowUpSequenceSchema),
  asyncHandler(startFollowUpSequenceController)
);
followUpRoutes.post(
  "/sequences/:sequenceId/e2e/accelerate",
  requireRole([UserRole.ADMIN]),
  asyncHandler(accelerateFollowUpSequenceForE2EController)
);
