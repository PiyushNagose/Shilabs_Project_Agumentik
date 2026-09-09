import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  assignLeadController,
  createLeadController,
  getLeadController,
  listLeadsController,
  updateLeadController,
  updateLeadStatusController
} from "./lead.controller.js";
import {
  assignLeadSchema,
  createLeadSchema,
  listLeadsQuerySchema,
  updateLeadSchema,
  updateLeadStatusSchema
} from "./lead.schemas.js";

export const leadRoutes = Router();

leadRoutes.use(requireAuth);
leadRoutes.post("/", validateBody(createLeadSchema), asyncHandler(createLeadController));
leadRoutes.get("/", validateQuery(listLeadsQuerySchema), asyncHandler(listLeadsController));
leadRoutes.get("/:id", asyncHandler(getLeadController));
leadRoutes.patch("/:id", validateBody(updateLeadSchema), asyncHandler(updateLeadController));
leadRoutes.patch("/:id/assign", validateBody(assignLeadSchema), asyncHandler(assignLeadController));
leadRoutes.patch(
  "/:id/status",
  validateBody(updateLeadStatusSchema),
  asyncHandler(updateLeadStatusController)
);
