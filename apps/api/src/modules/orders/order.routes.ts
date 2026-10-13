import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  createOrderController,
  getOrderController,
  getOrderSummaryController,
  listOrdersController,
  updateOrderController
} from "./order.controller.js";
import { createOrderSchema, listOrdersQuerySchema, updateOrderSchema } from "./order.schemas.js";

export const orderRoutes = Router();
orderRoutes.use(requireAuth);
orderRoutes.get("/summary", asyncHandler(getOrderSummaryController));
orderRoutes.get("/", validateQuery(listOrdersQuerySchema), asyncHandler(listOrdersController));
orderRoutes.post("/", validateBody(createOrderSchema), asyncHandler(createOrderController));
orderRoutes.get("/:id", asyncHandler(getOrderController));
orderRoutes.patch("/:id", validateBody(updateOrderSchema), asyncHandler(updateOrderController));
