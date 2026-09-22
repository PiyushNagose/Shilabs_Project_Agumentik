import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { getSalesActionDashboardController } from "./action-dashboard.controller.js";

export const actionDashboardRoutes = Router();

actionDashboardRoutes.use(requireAuth);
actionDashboardRoutes.get(
  "/",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  asyncHandler(getSalesActionDashboardController)
);
