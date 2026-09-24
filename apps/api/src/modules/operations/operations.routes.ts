import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { getOperationsDashboardController } from "./operations.controller.js";

export const operationsRoutes = Router();

operationsRoutes.use(requireAuth);
operationsRoutes.get(
  "/dashboard",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(getOperationsDashboardController)
);
