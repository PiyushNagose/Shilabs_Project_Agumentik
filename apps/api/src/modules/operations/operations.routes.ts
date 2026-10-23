import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { getRequiredUser, requireAuth } from "../../middleware/auth.middleware.js";
import { canAccessWorkspaceOperations } from "../authorization/workspace-permissions.js";
import { AppError } from "../../shared/errors.js";
import { getOperationsDashboardController } from "./operations.controller.js";

export const operationsRoutes = Router();

operationsRoutes.use(requireAuth);
operationsRoutes.get(
  "/dashboard",
  (request, _response, next) => {
    if (!canAccessWorkspaceOperations(getRequiredUser(request))) {
      next(new AppError(403, "AUTHORIZATION_ERROR", "Insufficient role permissions"));
      return;
    }
    next();
  },
  asyncHandler(getOperationsDashboardController)
);
