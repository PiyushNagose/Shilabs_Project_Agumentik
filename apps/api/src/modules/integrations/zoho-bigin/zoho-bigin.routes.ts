import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware.js";
import { getZohoBiginHealthController } from "./zoho-bigin.controller.js";
import { syncZohoDealsController } from "./zoho-bigin-deal-sync.controller.js";
import { syncZohoLeadContactsController } from "./zoho-bigin-sync.controller.js";
import { appendActivityToZohoTimelineController } from "./zoho-bigin-timeline.controller.js";

export const zohoBiginRoutes = Router();

zohoBiginRoutes.use(requireAuth);
zohoBiginRoutes.get(
  "/health",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(getZohoBiginHealthController)
);
zohoBiginRoutes.post(
  "/sync/leads-contacts",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(syncZohoLeadContactsController)
);
zohoBiginRoutes.post(
  "/sync/deals",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(syncZohoDealsController)
);
zohoBiginRoutes.post(
  "/timeline/activities/:activityId",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(appendActivityToZohoTimelineController)
);
