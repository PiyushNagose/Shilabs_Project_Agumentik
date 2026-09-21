import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createDealController,
  getDealController,
  updateDealController
} from "./deal.controller.js";
import { createDealSchema, updateDealSchema } from "./deal.schemas.js";

export const dealRoutes = Router();

dealRoutes.use(requireAuth);
dealRoutes.post("/", validateBody(createDealSchema), asyncHandler(createDealController));
dealRoutes.get("/:id", asyncHandler(getDealController));
dealRoutes.patch("/:id", validateBody(updateDealSchema), asyncHandler(updateDealController));
