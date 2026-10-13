import type { Request, Response } from "express";
import type { OrderDto, OrderSummaryDto, PaginatedResponse } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import {
  createOrder,
  getOrder,
  getOrderSummary,
  listOrders,
  updateOrder
} from "./order.service.js";
import type { CreateOrderInput, ListOrdersQuery, UpdateOrderInput } from "./order.schemas.js";

export async function listOrdersController(
  request: Request,
  response: Response<PaginatedResponse<OrderDto>>
): Promise<void> {
  response
    .status(200)
    .json(await listOrders(getRequiredUser(request), request.validatedQuery as ListOrdersQuery));
}
export async function getOrderSummaryController(
  request: Request,
  response: Response<OrderSummaryDto>
): Promise<void> {
  response.status(200).json(await getOrderSummary(getRequiredUser(request)));
}
export async function getOrderController(
  request: Request<{ id: string }>,
  response: Response<OrderDto>
): Promise<void> {
  response.status(200).json(await getOrder(getRequiredUser(request), request.params.id));
}
export async function createOrderController(
  request: Request<Record<string, never>, OrderDto, CreateOrderInput>,
  response: Response<OrderDto>
): Promise<void> {
  response.status(201).json(await createOrder(getRequiredUser(request), request.body));
}
export async function updateOrderController(
  request: Request<{ id: string }, OrderDto, UpdateOrderInput>,
  response: Response<OrderDto>
): Promise<void> {
  response
    .status(200)
    .json(await updateOrder(getRequiredUser(request), request.params.id, request.body));
}
