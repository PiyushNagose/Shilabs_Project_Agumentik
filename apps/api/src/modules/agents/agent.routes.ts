import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  createAgentController,
  getAgentController,
  listAgentsController,
  updateAgentController,
  updateAgentStatusController
} from "./agent.controller.js";
import {
  createAgentSchema,
  listAgentExecutionsQuerySchema,
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
