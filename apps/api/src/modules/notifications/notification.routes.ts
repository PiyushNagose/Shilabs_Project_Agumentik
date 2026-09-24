import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  acknowledgeNotificationController,
  escalateNotificationController,
  listNotificationsController,
  markNotificationReadController
} from "./notification.controller.js";
import {
  acknowledgeNotificationSchema,
  escalateNotificationSchema,
  listNotificationsQuerySchema
} from "./notification.schemas.js";

export const notificationRoutes = Router();

notificationRoutes.use(requireAuth);
notificationRoutes.get(
  "/",
  validateQuery(listNotificationsQuerySchema),
  asyncHandler(listNotificationsController)
);
notificationRoutes.patch("/:id/read", asyncHandler(markNotificationReadController));
notificationRoutes.patch(
  "/:id/acknowledge",
  validateBody(acknowledgeNotificationSchema),
  asyncHandler(acknowledgeNotificationController)
);
notificationRoutes.patch(
  "/:id/escalate",
  validateBody(escalateNotificationSchema),
  asyncHandler(escalateNotificationController)
);
