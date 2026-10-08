import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  createAgentController,
  getAgentController,
  listAgentsController,
  previewAgentComposerController,
  publishAgentComposerController,
  saveAgentComposerController,
  updateAgentController,
  updateAgentStatusController,
  validateAgentComposerController
} from "./agent.controller.js";
import {
  createAgentSchema,
  listAgentExecutionsQuerySchema,
  previewAgentComposerSchema,
  saveAgentComposerSchema,
  updateAgentSchema,
  updateAgentStatusSchema
} from "./agent.schemas.js";

export const agentRoutes = Router();
agentRoutes.use(requireAuth);
agentRoutes.get("/", asyncHandler(listAgentsController));
agentRoutes.post("/", validateBody(createAgentSchema), asyncHandler(createAgentController));
agentRoutes.get(
  "/:id",
  validateQuery(listAgentExecutionsQuerySchema),
  asyncHandler(getAgentController)
);
agentRoutes.patch("/:id", validateBody(updateAgentSchema), asyncHandler(updateAgentController));
agentRoutes.patch(
  "/:id/status",
  validateBody(updateAgentStatusSchema),
  asyncHandler(updateAgentStatusController)
);
agentRoutes.put(
  "/:id/composer",
  validateBody(saveAgentComposerSchema),
  asyncHandler(saveAgentComposerController)
);
agentRoutes.post("/:id/composer/validate", asyncHandler(validateAgentComposerController));
agentRoutes.post(
  "/:id/composer/preview",
  validateBody(previewAgentComposerSchema),
  asyncHandler(previewAgentComposerController)
);
agentRoutes.post("/:id/composer/publish", asyncHandler(publishAgentComposerController));
