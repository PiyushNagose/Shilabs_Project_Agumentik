import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateQuery } from "../../middleware/validate.middleware.js";
import { listNotificationsController } from "./notification.controller.js";
import { listNotificationsQuerySchema } from "./notification.schemas.js";

export const notificationRoutes = Router();

notificationRoutes.use(requireAuth);
notificationRoutes.get(
  "/",
  validateQuery(listNotificationsQuerySchema),
  asyncHandler(listNotificationsController)
);
