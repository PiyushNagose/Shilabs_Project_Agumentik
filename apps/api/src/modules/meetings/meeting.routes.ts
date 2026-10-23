import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  cancelMeetingRequestController,
  recordMeetingOutcomeController,
  rescheduleMeetingRequestController,
  confirmMeetingRequestController,
  createMeetingRequestController,
  getMeetingRequestController,
  listMeetingRequestsController
} from "./meeting.controller.js";
import {
  cancelMeetingRequestSchema,
  meetingOutcomeSchema,
  rescheduleMeetingSchema,
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
meetingRoutes.get(
  "/requests/:id",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  asyncHandler(getMeetingRequestController)
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
meetingRoutes.post(
  "/requests/:id/cancel",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(cancelMeetingRequestSchema),
  asyncHandler(cancelMeetingRequestController)
);
meetingRoutes.post(
  "/requests/:id/outcome",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(meetingOutcomeSchema),
  asyncHandler(recordMeetingOutcomeController)
);
meetingRoutes.post(
  "/requests/:id/reschedule",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(rescheduleMeetingSchema),
  asyncHandler(rescheduleMeetingRequestController)
);
