import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import { listLeadActivitiesController } from "../activities/activity.controller.js";
import {
  assignLeadController,
  createLeadController,
  getLeadController,
  listLeadsController,
  updateLeadStageController,
  updateLeadController,
  updateLeadStatusController
} from "./lead.controller.js";
import {
  getQualificationController,
  recalculateQualificationController,
  updateQualificationController
} from "../qualification/qualification.controller.js";
import { updateQualificationSchema } from "../qualification/qualification.schemas.js";
import {
  overrideLeadScoreController,
  recalculateLeadScoreController
} from "../scoring/scoring.controller.js";
import { overrideLeadScoreSchema } from "../scoring/scoring.schemas.js";
import {
  assignLeadSchema,
  createLeadSchema,
  listLeadsQuerySchema,
  updateLeadStageSchema,
  updateLeadSchema,
  updateLeadStatusSchema
} from "./lead.schemas.js";

export const leadRoutes = Router();

leadRoutes.use(requireAuth);
leadRoutes.post("/", validateBody(createLeadSchema), asyncHandler(createLeadController));
leadRoutes.get("/", validateQuery(listLeadsQuerySchema), asyncHandler(listLeadsController));
leadRoutes.get("/:id/activities", asyncHandler(listLeadActivitiesController));
leadRoutes.get("/:id/qualification", asyncHandler(getQualificationController));
leadRoutes.patch(
  "/:id/qualification",
  validateBody(updateQualificationSchema),
  asyncHandler(updateQualificationController)
);
leadRoutes.post("/:id/qualification/recalculate", asyncHandler(recalculateQualificationController));
leadRoutes.post("/:id/recalculate-score", asyncHandler(recalculateLeadScoreController));
leadRoutes.patch(
  "/:id/score-override",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateBody(overrideLeadScoreSchema),
  asyncHandler(overrideLeadScoreController)
);
leadRoutes.patch("/:id/assign", validateBody(assignLeadSchema), asyncHandler(assignLeadController));
leadRoutes.patch(
  "/:id/stage",
  validateBody(updateLeadStageSchema),
  asyncHandler(updateLeadStageController)
);
leadRoutes.patch(
  "/:id/status",
  validateBody(updateLeadStatusSchema),
  asyncHandler(updateLeadStatusController)
);
leadRoutes.get("/:id", asyncHandler(getLeadController));
leadRoutes.patch("/:id", validateBody(updateLeadSchema), asyncHandler(updateLeadController));
