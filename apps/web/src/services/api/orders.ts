import type {
  FulfillmentStatusName,
  OrderDto,
  OrderSummaryDto,
  PaginatedResponse,
  PaymentStatusName
} from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export interface OrderItemBody {
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: string;
}
export interface OrderBody {
  companyId?: string;
  contactId?: string | null;
  dealId?: string | null;
  ownerId?: string | null;
  paymentStatus?: PaymentStatusName;
  fulfillmentStatus?: FulfillmentStatusName;
  currency?: string;
  notes?: string | null;
  orderedAt?: string;
  items?: OrderItemBody[];
}
export interface OrderListParams {
  search?: string;
  paymentStatus?: PaymentStatusName;
  fulfillmentStatus?: FulfillmentStatusName;
  ownerId?: string;
  page?: number;
  pageSize?: number;
}

function query(params: OrderListParams): string {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") values.set(key, String(value));
  return values.size ? `?${values.toString()}` : "";
}

export function listOrders(
  token: string,
  params: OrderListParams = {}
): Promise<PaginatedResponse<OrderDto>> {
  return apiRequest(`/api/orders${query(params)}`, token);
}
export function getOrderSummary(token: string): Promise<OrderSummaryDto> {
  return apiRequest("/api/orders/summary", token);
}
export function getOrder(token: string, id: string): Promise<OrderDto> {
  return apiRequest(`/api/orders/${id}`, token);
}
export function createOrder(
  token: string,
  body: OrderBody & { companyId: string; items: OrderItemBody[] }
): Promise<OrderDto> {
  return apiRequest("/api/orders", token, { method: "POST", body: JSON.stringify(body) });
}
export function updateOrder(token: string, id: string, body: OrderBody): Promise<OrderDto> {
  return apiRequest(`/api/orders/${id}`, token, { method: "PATCH", body: JSON.stringify(body) });
}
