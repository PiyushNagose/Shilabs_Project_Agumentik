import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { createPipelineController, createPipelineStageController, listPipelinesController, listPipelineStagesController, reorderPipelineStagesController, updatePipelineController, updatePipelineStageController } from "./pipeline.controller.js";
import { createPipelineSchema, createPipelineStageSchema, reorderPipelineStagesSchema, updatePipelineSchema, updatePipelineStageSchema } from "./pipeline.schemas.js";

export const pipelineRoutes = Router();
pipelineRoutes.use(requireAuth);
pipelineRoutes.get("/", asyncHandler(listPipelinesController));
pipelineRoutes.post("/", validateBody(createPipelineSchema), asyncHandler(createPipelineController));
pipelineRoutes.get("/stages", asyncHandler(listPipelineStagesController));
pipelineRoutes.patch("/stages/:id", validateBody(updatePipelineStageSchema), asyncHandler(updatePipelineStageController));
pipelineRoutes.patch("/:id", validateBody(updatePipelineSchema), asyncHandler(updatePipelineController));
pipelineRoutes.post("/:id/stages", validateBody(createPipelineStageSchema), asyncHandler(createPipelineStageController));
pipelineRoutes.put("/:id/stages/order", validateBody(reorderPipelineStagesSchema), asyncHandler(reorderPipelineStagesController));
