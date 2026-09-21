import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { getScoringConfigController, updateScoringConfigController } from "./scoring.controller.js";
import { updateScoringConfigSchema } from "./scoring.schemas.js";

export const scoringRoutes = Router();

scoringRoutes.use(requireAuth);
scoringRoutes.get("/config", asyncHandler(getScoringConfigController));
scoringRoutes.patch(
  "/config",
  requireRole([UserRole.ADMIN]),
  validateBody(updateScoringConfigSchema),
  asyncHandler(updateScoringConfigController)
);
