import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { listPipelineStagesController } from "./pipeline.controller.js";

export const pipelineRoutes = Router();

pipelineRoutes.use(requireAuth);
pipelineRoutes.get("/stages", asyncHandler(listPipelineStagesController));
