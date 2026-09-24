import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  confirmMeetingRequestController,
  createMeetingRequestController,
  listMeetingRequestsController
} from "./meeting.controller.js";
import {
  confirmMeetingRequestSchema,
  createMeetingRequestSchema,
  listMeetingRequestsQuerySchema
} from "./meeting.schemas.js";

export const meetingRoutes = Router();

meetingRoutes.use(requireAuth);
meetingRoutes.get(
  "/requests",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateQuery(listMeetingRequestsQuerySchema),
  asyncHandler(listMeetingRequestsController)
);
meetingRoutes.post(
  "/requests",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(createMeetingRequestSchema),
  asyncHandler(createMeetingRequestController)
);
meetingRoutes.post(
  "/requests/:id/confirm",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(confirmMeetingRequestSchema),
  asyncHandler(confirmMeetingRequestController)
);
