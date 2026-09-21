import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateQuery } from "../../middleware/validate.middleware.js";
import {
  listDomainEventsController,
  retryDomainEventController
} from "./domain-events.controller.js";
import { listDomainEventsQuerySchema } from "./domain-events.schemas.js";

export const domainEventRoutes = Router();

domainEventRoutes.use(requireAuth);
domainEventRoutes.get(
  "/",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateQuery(listDomainEventsQuerySchema),
  asyncHandler(listDomainEventsController)
);
domainEventRoutes.post(
  "/:id/retry",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(retryDomainEventController)
);
