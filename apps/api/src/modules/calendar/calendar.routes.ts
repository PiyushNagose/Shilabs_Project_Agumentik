import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  getCalendarAvailabilityController,
  getCalendarHealthController
} from "./calendar.controller.js";
import { calendarAvailabilitySchema } from "./calendar.schemas.js";

export const calendarRoutes = Router();

calendarRoutes.use(requireAuth);

calendarRoutes.get(
  "/health",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(getCalendarHealthController)
);

calendarRoutes.post(
  "/availability",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(calendarAvailabilitySchema),
  asyncHandler(getCalendarAvailabilityController)
);
