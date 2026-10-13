import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createWorkflowController,
  executeWorkflowController,
  getWorkflowController,
  listWorkflowsController,
  previewWorkflowController,
  publishWorkflowController,
  saveWorkflowDraftController,
  updateWorkflowController,
  updateWorkflowStatusController,
  validateWorkflowController
} from "./workflow.controller.js";
import {
  createWorkflowSchema,
  executeWorkflowSchema,
  previewWorkflowSchema,
  saveWorkflowDraftSchema,
  updateWorkflowSchema,
  updateWorkflowStatusSchema
} from "./workflow.schemas.js";

export const workflowRoutes = Router();
workflowRoutes.use(requireAuth);
workflowRoutes.get("/", asyncHandler(listWorkflowsController));
workflowRoutes.post(
  "/",
  validateBody(createWorkflowSchema),
  asyncHandler(createWorkflowController)
);
workflowRoutes.get("/:id", asyncHandler(getWorkflowController));
workflowRoutes.patch(
  "/:id",
  validateBody(updateWorkflowSchema),
  asyncHandler(updateWorkflowController)
);
workflowRoutes.patch(
  "/:id/status",
  validateBody(updateWorkflowStatusSchema),
  asyncHandler(updateWorkflowStatusController)
);
workflowRoutes.put(
  "/:id/draft",
  validateBody(saveWorkflowDraftSchema),
  asyncHandler(saveWorkflowDraftController)
);
workflowRoutes.post("/:id/validate", asyncHandler(validateWorkflowController));
workflowRoutes.post(
  "/:id/preview",
  validateBody(previewWorkflowSchema),
  asyncHandler(previewWorkflowController)
);
workflowRoutes.post("/:id/publish", asyncHandler(publishWorkflowController));
workflowRoutes.post(
  "/:id/execute",
  validateBody(executeWorkflowSchema),
  asyncHandler(executeWorkflowController)
);
