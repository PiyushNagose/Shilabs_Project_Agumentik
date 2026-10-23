import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { getManagerAccountabilityReportController } from "./analytics.controller.js";

export const analyticsRoutes = Router();

analyticsRoutes.use(requireAuth);
analyticsRoutes.get(
  "/accountability",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(getManagerAccountabilityReportController)
);
