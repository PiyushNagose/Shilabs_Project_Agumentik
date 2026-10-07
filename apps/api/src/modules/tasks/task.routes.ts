import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  completeTaskController,
  createTaskController,
  getTaskController,
  listTasksController,
  updateTaskController
} from "./task.controller.js";
import { createTaskSchema, listTasksQuerySchema, updateTaskSchema } from "./task.schemas.js";

export const taskRoutes = Router();
taskRoutes.use(requireAuth);
taskRoutes.get("/", validateQuery(listTasksQuerySchema), asyncHandler(listTasksController));
taskRoutes.post("/", validateBody(createTaskSchema), asyncHandler(createTaskController));
taskRoutes.get("/:id", asyncHandler(getTaskController));
taskRoutes.patch("/:id", validateBody(updateTaskSchema), asyncHandler(updateTaskController));
taskRoutes.post("/:id/complete", asyncHandler(completeTaskController));
