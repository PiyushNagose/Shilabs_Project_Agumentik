import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  createDealController,
  getDealController,
  listDealsController,
  updateDealController
} from "./deal.controller.js";
import { createDealSchema, listDealsQuerySchema, updateDealSchema } from "./deal.schemas.js";

export const dealRoutes = Router();

dealRoutes.use(requireAuth);
dealRoutes.get("/", validateQuery(listDealsQuerySchema), asyncHandler(listDealsController));
dealRoutes.post("/", validateBody(createDealSchema), asyncHandler(createDealController));
dealRoutes.get("/:id", asyncHandler(getDealController));
dealRoutes.patch("/:id", validateBody(updateDealSchema), asyncHandler(updateDealController));
