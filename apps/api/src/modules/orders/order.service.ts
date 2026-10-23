import { randomUUID } from "node:crypto";
import { Prisma, type FulfillmentStatus, type PaymentStatus } from "@prisma/client";
import type { OrderDto, OrderSummaryDto, PaginatedResponse } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { assertCanAccessCompany } from "../authorization/crm-record.permissions.js";
import { isWorkspaceManager } from "../authorization/workspace-permissions.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { assertCanMutateLead, leadVisibilityWhere } from "../leads/lead.permissions.js";
import { toDealDto } from "../deals/deal.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import type { CreateOrderInput, ListOrdersQuery, UpdateOrderInput } from "./order.schemas.js";
import { findOrder, listOrderRecords, orderInclude, type OrderRecord } from "./order.repository.js";

function workspaceIdFor(actor: AuthenticatedUser): string {
  if (!actor.activeWorkspaceId)
    throw new AppError(403, "AUTHORIZATION_ERROR", "Active workspace required");
  return actor.activeWorkspaceId;
}

function isManager(actor: AuthenticatedUser): boolean {
  return isWorkspaceManager(actor);
}

function visibleWhere(actor: AuthenticatedUser): Prisma.OrderWhereInput {
  const workspaceId = workspaceIdFor(actor);
  if (isManager(actor)) return { workspaceId };
  return {
    workspaceId,
    OR: [
      { ownerId: actor.id },
      { ownerId: null, deal: null },
      { deal: { lead: leadVisibilityWhere(actor) } }
    ]
  };
}

function orderNumber(): string {
  return `ORD-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export function toOrderDto(order: OrderRecord): OrderDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    companyId: order.companyId,
    contactId: order.contactId,
    dealId: order.dealId,
    ownerId: order.ownerId,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    currency: order.currency,
    subtotal: money(order.subtotal),
    total: money(order.total),
    notes: order.notes,
    orderedAt: order.orderedAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
    canceledAt: order.canceledAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    company: {
      ...order.company,
      createdAt: order.company.createdAt.toISOString(),
      updatedAt: order.company.updatedAt.toISOString()
    },
    contact: order.contact
      ? {
          ...order.contact,
          createdAt: order.contact.createdAt.toISOString(),
          updatedAt: order.contact.updatedAt.toISOString()
        }
      : null,
    deal: order.deal ? toDealDto(order.deal) : null,
    owner: order.owner ? toPublicUser(order.owner) : null,
    items: order.items.map((item) => ({
      id: item.id,
      orderId: item.orderId,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
      lineTotal: money(item.lineTotal),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    }))
  };
}

function itemData(
  workspaceId: string,
  items: CreateOrderInput["items"]
): {
  subtotal: Prisma.Decimal;
  create: Prisma.OrderItemCreateWithoutOrderInput[];
} {
  const create = items.map((item) => {
    const unitPrice = new Prisma.Decimal(item.unitPrice);
    const lineTotal = unitPrice.mul(item.quantity);
    return {
      workspaceId,
      name: item.name,
      description: item.description ?? null,
      quantity: item.quantity,
      unitPrice,
      lineTotal
    };
  });
  return {
    create,
    subtotal: create.reduce((total, item) => total.add(item.lineTotal), new Prisma.Decimal(0))
  };
}

async function resolveRelations(
  actor: AuthenticatedUser,
  input: {
    companyId: string;
    contactId?: string | null;
    dealId?: string | null;
    ownerId?: string | null;
  }
) {
  const workspaceId = workspaceIdFor(actor);
  await assertCanAccessCompany(actor, input.companyId, { allowUnlinked: true });
  const deal = input.dealId
    ? await prisma.deal.findFirst({
        where: { id: input.dealId, workspaceId },
        include: { lead: true }
      })
    : null;
  if (input.dealId && !deal) throw new AppError(404, "NOT_FOUND", "Deal not found");
  if (deal) {
    assertCanMutateLead(actor, deal.lead);
    if (deal.lead.companyId !== input.companyId)
      throw new AppError(400, "VALIDATION_ERROR", "Deal does not belong to the selected company");
  }
  const contactId =
    input.contactId === undefined ? (deal?.lead.contactId ?? null) : input.contactId;
  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      select: { companyId: true }
    });
    if (!contact) throw new AppError(404, "NOT_FOUND", "Contact not found");
    if (contact.companyId !== input.companyId)
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "Contact does not belong to the selected company"
      );
  }
  const ownerId = input.ownerId === undefined ? (deal?.ownerId ?? actor.id) : input.ownerId;
  if (!isManager(actor) && ownerId && ownerId !== actor.id)
    throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot assign an order to another salesperson");
  if (ownerId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: ownerId, status: "ACTIVE", user: { status: "ACTIVE" } },
      select: { id: true }
    });
    if (!member)
      throw new AppError(400, "VALIDATION_ERROR", "Owner is not an active workspace member");
  }
  return { workspaceId, deal, contactId, ownerId };
}

function snapshot(order: OrderRecord): Prisma.InputJsonObject {
  return {
    orderNumber: order.orderNumber,
    companyId: order.companyId,
    contactId: order.contactId,
    dealId: order.dealId,
    ownerId: order.ownerId,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    currency: order.currency,
    total: order.total.toString()
  };
}

function activityType(
  before: OrderRecord | null,
  paymentStatus: PaymentStatus,
  fulfillmentStatus: FulfillmentStatus
) {
  if (!before) return "ORDER_CREATED" as const;
  if (before.paymentStatus !== paymentStatus) return "ORDER_PAYMENT_STATUS_CHANGED" as const;
  if (before.fulfillmentStatus !== fulfillmentStatus)
    return "ORDER_FULFILLMENT_STATUS_CHANGED" as const;
  return "ORDER_UPDATED" as const;
}

async function recordOrderChange(
  tx: Prisma.TransactionClient,
  input: {
    actor: AuthenticatedUser;
    before: OrderRecord | null;
    order: OrderRecord;
    leadId: string | null;
    correlationId: string;
  }
): Promise<void> {
  const type = activityType(input.before, input.order.paymentStatus, input.order.fulfillmentStatus);
  if (input.leadId) {
    await tx.activity.create({
      data: {
        workspaceId: input.order.workspaceId,
        leadId: input.leadId,
        entityType: "ORDER",
        entityId: input.order.id,
        actorType: "USER",
        actorUserId: input.actor.id,
        sourceType: "ORDER_API",
        sourceId: input.order.id,
        type,
        title: type === "ORDER_CREATED" ? "Order created" : "Order updated",
        description: `${input.order.orderNumber} is ${input.order.paymentStatus.toLowerCase().replaceAll("_", " ")} and ${input.order.fulfillmentStatus.toLowerCase().replaceAll("_", " ")}.`,
        metadata: {
          paymentStatus: input.order.paymentStatus,
          fulfillmentStatus: input.order.fulfillmentStatus,
          total: input.order.total.toString(),
          currency: input.order.currency
        },
        correlationId: input.correlationId,
        visibility: "BUSINESS"
      }
    });
  }
  await tx.auditEvent.create({
    data: {
      workspaceId: input.order.workspaceId,
      actorType: "USER",
      actorId: input.actor.id,
      actorUserId: input.actor.id,
      sourceType: "ORDER_API",
      sourceId: input.order.id,
      entityType: "Order",
      entityId: input.order.id,
      action: type,
      before: input.before ? snapshot(input.before) : undefined,
      after: snapshot(input.order),
      correlationId: input.correlationId
    }
  });
}

export async function listOrders(
  actor: AuthenticatedUser,
  query: ListOrdersQuery
): Promise<PaginatedResponse<OrderDto>> {
  const scope = visibleWhere(actor);
  const where: Prisma.OrderWhereInput = {
    AND: [
      scope,
      {
        paymentStatus: query.paymentStatus,
        fulfillmentStatus: query.fulfillmentStatus,
        ownerId: query.ownerId
      },
      ...(query.search
        ? [
            {
              OR: [
                { orderNumber: { contains: query.search, mode: "insensitive" as const } },
                { company: { name: { contains: query.search, mode: "insensitive" as const } } },
                {
                  contact: { firstName: { contains: query.search, mode: "insensitive" as const } }
                },
                { contact: { lastName: { contains: query.search, mode: "insensitive" as const } } },
                { contact: { email: { contains: query.search, mode: "insensitive" as const } } }
              ]
            }
          ]
        : [])
    ]
  };
  const result = await listOrderRecords({
    where,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize
  });
  return {
    items: result.orders.map(toOrderDto),
    page: query.page,
    pageSize: query.pageSize,
    total: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / query.pageSize))
  };
}

export async function getOrder(actor: AuthenticatedUser, id: string): Promise<OrderDto> {
  const order = await prisma.order.findFirst({
    where: { id, ...visibleWhere(actor) },
    include: orderInclude
  });
  if (!order) throw new AppError(404, "NOT_FOUND", "Order not found");
  return toOrderDto(order);
}

export async function getOrderSummary(actor: AuthenticatedUser): Promise<OrderSummaryDto> {
  const where = visibleWhere(actor);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [totalOrders, unfulfilled, processing, fulfilledToday, revenue, average, first] =
    await Promise.all([
      prisma.order.count({ where }),
      prisma.order.count({ where: { AND: [where, { fulfillmentStatus: "UNFULFILLED" }] } }),
      prisma.order.count({ where: { AND: [where, { fulfillmentStatus: "PROCESSING" }] } }),
      prisma.order.count({ where: { AND: [where, { fulfilledAt: { gte: start } }] } }),
      prisma.order.aggregate({
        where: { AND: [where, { paidAt: { gte: start } }] },
        _sum: { total: true }
      }),
      prisma.order.aggregate({ where, _avg: { total: true } }),
      prisma.order.findFirst({ where, select: { currency: true }, orderBy: { createdAt: "asc" } })
    ]);
  return {
    totalOrders,
    unfulfilled,
    processing,
    fulfilledToday,
    revenueToday: revenue._sum.total?.toFixed(2) ?? "0.00",
    averageOrderValue: average._avg.total?.toFixed(2) ?? "0.00",
    currency: first?.currency ?? "INR"
  };
}

export async function createOrder(
  actor: AuthenticatedUser,
  input: CreateOrderInput
): Promise<OrderDto> {
  const relation = await resolveRelations(actor, input);
  const items = itemData(relation.workspaceId, input.items);
  const correlationId = randomUUID();
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        workspaceId: relation.workspaceId,
        orderNumber: orderNumber(),
        companyId: input.companyId,
        contactId: relation.contactId,
        dealId: relation.deal?.id ?? null,
        ownerId: relation.ownerId,
        paymentStatus: input.paymentStatus,
        fulfillmentStatus: input.fulfillmentStatus,
        currency: input.currency,
        subtotal: items.subtotal,
        total: items.subtotal,
        notes: input.notes ?? null,
        orderedAt: input.orderedAt ? new Date(input.orderedAt) : undefined,
        paidAt: input.paymentStatus === "PAID" ? new Date() : null,
        fulfilledAt: input.fulfillmentStatus === "FULFILLED" ? new Date() : null,
        canceledAt: input.fulfillmentStatus === "CANCELED" ? new Date() : null,
        items: { create: items.create }
      },
      include: orderInclude
    });
    await recordOrderChange(tx, {
      actor,
      before: null,
      order: created,
      leadId: relation.deal?.leadId ?? null,
      correlationId
    });
    return created;
  }, { maxWait: 10_000, timeout: 30_000 });
  await publishRealtimeEvent({
    entityType: "order",
    action: "order-created",
    orderId: order.id,
    leadId: relation.deal?.leadId ?? null,
    workspaceId: relation.workspaceId
  });
  return toOrderDto(order);
}

export async function updateOrder(
  actor: AuthenticatedUser,
  id: string,
  input: UpdateOrderInput
): Promise<OrderDto> {
  const existing = await findOrder(id, workspaceIdFor(actor));
  if (!existing) throw new AppError(404, "NOT_FOUND", "Order not found");
  if (
    !isManager(actor) &&
    existing.ownerId !== null &&
    existing.ownerId !== actor.id &&
    existing.deal?.lead.ownerId !== actor.id
  )
    throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot update another salesperson's order");
  const relation = await resolveRelations(actor, {
    companyId: input.companyId ?? existing.companyId,
    contactId: "contactId" in input ? input.contactId : existing.contactId,
    dealId: "dealId" in input ? input.dealId : existing.dealId,
    ownerId: "ownerId" in input ? input.ownerId : existing.ownerId
  });
  const replacement = input.items ? itemData(existing.workspaceId, input.items) : null;
  const paymentStatus = input.paymentStatus ?? existing.paymentStatus;
  const fulfillmentStatus = input.fulfillmentStatus ?? existing.fulfillmentStatus;
  const correlationId = randomUUID();
  const order = await prisma.$transaction(async (tx) => {
    if (replacement)
      await tx.orderItem.deleteMany({ where: { orderId: id, workspaceId: existing.workspaceId } });
    const updated = await tx.order.update({
      where: { id },
      data: {
        companyId: input.companyId,
        contactId: relation.contactId,
        dealId: relation.deal?.id ?? null,
        ownerId: relation.ownerId,
        paymentStatus,
        fulfillmentStatus,
        currency: input.currency,
        subtotal: replacement?.subtotal,
        total: replacement?.subtotal,
        notes: "notes" in input ? (input.notes ?? null) : undefined,
        orderedAt: input.orderedAt ? new Date(input.orderedAt) : undefined,
        paidAt: paymentStatus === "PAID" ? (existing.paidAt ?? new Date()) : null,
        fulfilledAt:
          fulfillmentStatus === "FULFILLED" ? (existing.fulfilledAt ?? new Date()) : null,
        canceledAt: fulfillmentStatus === "CANCELED" ? (existing.canceledAt ?? new Date()) : null,
        items: replacement ? { create: replacement.create } : undefined
      },
      include: orderInclude
    });
    await recordOrderChange(tx, {
      actor,
      before: existing,
      order: updated,
      leadId: relation.deal?.leadId ?? null,
      correlationId
    });
    return updated;
  }, { maxWait: 10_000, timeout: 30_000 });
  await publishRealtimeEvent({
    entityType: "order",
    action: "order-updated",
    orderId: order.id,
    leadId: relation.deal?.leadId ?? null,
    workspaceId: existing.workspaceId
  });
  return toOrderDto(order);
}
