import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createUserController,
  getUserController,
  listUsersController,
  updateUserController,
  updateUserStatusController
} from "./user.controller.js";
import { createUserSchema, updateUserSchema, updateUserStatusSchema } from "./user.schemas.js";

export const userRoutes = Router();

userRoutes.use(requireAuth);
userRoutes.get(
  "/",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(listUsersController)
);
userRoutes.get("/:id", asyncHandler(getUserController));
userRoutes.post(
  "/",
  requireRole([UserRole.ADMIN]),
  validateBody(createUserSchema),
  asyncHandler(createUserController)
);
userRoutes.patch(
  "/:id",
  requireRole([UserRole.ADMIN]),
  validateBody(updateUserSchema),
  asyncHandler(updateUserController)
);
userRoutes.patch(
  "/:id/status",
  requireRole([UserRole.ADMIN]),
  validateBody(updateUserStatusSchema),
  asyncHandler(updateUserStatusController)
);
