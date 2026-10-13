import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  connectIntegrationController,
  disableIntegrationController,
  disconnectIntegrationController,
  listIntegrationsController,
  reconnectIntegrationController
} from "./integration.controller.js";
import { connectIntegrationSchema } from "./integration.schemas.js";

export const integrationRoutes = Router();
integrationRoutes.use(requireAuth);
integrationRoutes.get("/", asyncHandler(listIntegrationsController));
integrationRoutes.post(
  "/catalog/:key/connect",
  validateBody(connectIntegrationSchema),
  asyncHandler(connectIntegrationController)
);
integrationRoutes.post("/connections/:id/reconnect", asyncHandler(reconnectIntegrationController));
integrationRoutes.post("/connections/:id/disable", asyncHandler(disableIntegrationController));
integrationRoutes.delete("/connections/:id", asyncHandler(disconnectIntegrationController));
