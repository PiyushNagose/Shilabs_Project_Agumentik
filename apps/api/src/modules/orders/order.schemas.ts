import { z } from "zod";
import { FULFILLMENT_STATUSES, PAYMENT_STATUSES } from "@shilabs/shared-types";

const nullableId = z.string().trim().min(1).nullable().optional();
const money = z.union([z.string().trim().min(1), z.number().nonnegative()]).transform(String);

const orderItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  quantity: z.number().int().min(1).max(100000),
  unitPrice: money
});

export const createOrderSchema = z.object({
  companyId: z.string().trim().min(1),
  contactId: nullableId,
  dealId: nullableId,
  ownerId: nullableId,
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES).optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .default("INR"),
  notes: z.string().trim().max(4000).nullable().optional(),
  orderedAt: z.iso.datetime().optional(),
  items: z.array(orderItemSchema).min(1).max(100)
});

export const updateOrderSchema = createOrderSchema
  .omit({ items: true })
  .partial()
  .extend({ items: z.array(orderItemSchema).min(1).max(100).optional() })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

export const listOrdersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES).optional(),
  ownerId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
