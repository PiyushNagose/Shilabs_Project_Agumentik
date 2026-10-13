import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type {
  AuthResponse,
  OrderDto,
  OrderSummaryDto,
  PaginatedResponse
} from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import { resolveRealtimeEventScope } from "../realtime/realtime.service.js";

const app = createApp();
const marker = `phase11-${randomUUID()}`;
const password = "CorrectHorse123!";

async function user(label: string, role: UserRole, workspaceId: string) {
  const created = await prisma.user.create({
    data: {
      email: `${marker}-${label}@example.local`,
      passwordHash: await hashPassword(password),
      firstName: label,
      lastName: "Orders",
      role,
      status: UserStatus.ACTIVE
    }
  });
  await prisma.workspaceMember.create({
    data: {
      workspaceId,
      userId: created.id,
      role:
        role === UserRole.ADMIN
          ? "ADMIN"
          : role === UserRole.SALES_MANAGER
            ? "SALES_MANAGER"
            : "SALES_REP",
      status: "ACTIVE"
    }
  });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: created.email, password })
    .expect(200);
  return { ...created, token: (login.body as AuthResponse).accessToken };
}

function api(method: "get" | "post" | "patch", path: string, token: string, workspaceId: string) {
  const call =
    method === "get"
      ? request(app).get(path)
      : method === "post"
        ? request(app).post(path)
        : request(app).patch(path);
  return call.set("Authorization", `Bearer ${token}`).set("x-workspace-id", workspaceId);
}

async function crmRecord(workspaceId: string, ownerId: string, label: string) {
  const pipeline = await prisma.pipeline.create({
    data: { workspaceId, name: `${marker}-${label}`, isDefault: true }
  });
  const stage = await prisma.pipelineStage.create({
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      key: `${marker}-${label}`,
      semanticKey: "WON",
      label: "Won",
      order: -Number.parseInt(randomUUID().slice(0, 7), 16),
      position: 1,
      probability: 100,
      isClosed: true,
      isWon: true
    }
  });
  const company = await prisma.company.create({
    data: { workspaceId, name: `${marker} ${label} Company` }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId,
      companyId: company.id,
      firstName: label,
      lastName: "Buyer",
      email: `${marker}-${label}-buyer@example.local`
    }
  });
  const lead = await prisma.lead.create({
    data: {
      workspaceId,
      companyId: company.id,
      contactId: contact.id,
      ownerId,
      source: "phase11-test",
      stageId: stage.id
    }
  });
  const deal = await prisma.deal.create({
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      leadId: lead.id,
      stageId: stage.id,
      ownerId,
      probability: 100,
      status: "WON"
    }
  });
  return { company, contact, lead, deal };
}

describe("Phase 11 orders API", () => {
  afterAll(async () => {
    const workspaces = await prisma.workspace.findMany({
      where: { slug: { startsWith: marker } },
      select: { id: true }
    });
    const workspaceIds = workspaces.map(({ id }) => id);
    const users = await prisma.user.findMany({
      where: { email: { startsWith: marker } },
      select: { id: true }
    });
    const userIds = users.map(({ id }) => id);
    await prisma.order.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.activity.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.deal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.lead.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.contact.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.company.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.pipelineStage.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.pipeline.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("creates a CRM-linked order with server-calculated totals, activity, audit, and separate states", async () => {
    const workspace = await prisma.workspace.create({
      data: { name: `${marker}-create`, slug: `${marker}-create` }
    });
    const admin = await user("admin", UserRole.ADMIN, workspace.id);
    const crm = await crmRecord(workspace.id, admin.id, "create");
    const response = await api("post", "/api/orders", admin.token, workspace.id)
      .send({
        companyId: crm.company.id,
        contactId: crm.contact.id,
        dealId: crm.deal.id,
        paymentStatus: "PARTIALLY_PAID",
        fulfillmentStatus: "PROCESSING",
        currency: "usd",
        items: [
          { name: "Implementation", quantity: 2, unitPrice: "125.50" },
          { name: "Support", quantity: 1, unitPrice: "49.00" }
        ]
      })
      .expect(201);
    const order = response.body as OrderDto;
    expect(order.total).toBe("300.00");
    expect(order.currency).toBe("USD");
    expect(order.paymentStatus).toBe("PARTIALLY_PAID");
    expect(order.fulfillmentStatus).toBe("PROCESSING");
    expect(order.items).toHaveLength(2);
    expect(
      await prisma.activity.findFirst({
        where: { entityType: "ORDER", entityId: order.id, type: "ORDER_CREATED" }
      })
    ).not.toBeNull();
    expect(
      await prisma.auditEvent.findFirst({
        where: { entityType: "Order", entityId: order.id, action: "ORDER_CREATED" }
      })
    ).not.toBeNull();
    await expect(resolveRealtimeEventScope({ orderId: order.id })).resolves.toEqual({
      workspaceId: workspace.id,
      ownerId: admin.id
    });
  });

  it("blocks cross-workspace order and relationship access", async () => {
    const workspaceA = await prisma.workspace.create({
      data: { name: `${marker}-scope-a`, slug: `${marker}-scope-a` }
    });
    const workspaceB = await prisma.workspace.create({
      data: { name: `${marker}-scope-b`, slug: `${marker}-scope-b` }
    });
    const adminA = await user("scope-a", UserRole.ADMIN, workspaceA.id);
    const adminB = await user("scope-b", UserRole.ADMIN, workspaceB.id);
    const crmA = await crmRecord(workspaceA.id, adminA.id, "scope-a");
    const crmB = await crmRecord(workspaceB.id, adminB.id, "scope-b");
    const order = (
      await api("post", "/api/orders", adminA.token, workspaceA.id)
        .send({
          companyId: crmA.company.id,
          dealId: crmA.deal.id,
          items: [{ name: "Service", quantity: 1, unitPrice: "500" }]
        })
        .expect(201)
    ).body as OrderDto;
    await api("get", `/api/orders/${order.id}`, adminB.token, workspaceB.id).expect(404);
    await api("post", "/api/orders", adminA.token, workspaceA.id)
      .send({
        companyId: crmA.company.id,
        contactId: crmB.contact.id,
        items: [{ name: "Invalid", quantity: 1, unitPrice: "1" }]
      })
      .expect(404);
    const list = (await api("get", "/api/orders", adminB.token, workspaceB.id).expect(200))
      .body as PaginatedResponse<OrderDto>;
    expect(list.items.some((item) => item.id === order.id)).toBe(false);
  });

  it("enforces salesperson visibility and updates payment and fulfillment independently", async () => {
    const workspace = await prisma.workspace.create({
      data: { name: `${marker}-rbac`, slug: `${marker}-rbac` }
    });
    const manager = await user("manager", UserRole.SALES_MANAGER, workspace.id);
    const rep = await user("rep", UserRole.SALES_REP, workspace.id);
    const otherRep = await user("other-rep", UserRole.SALES_REP, workspace.id);
    const crm = await crmRecord(workspace.id, rep.id, "rbac");
    const created = (
      await api("post", "/api/orders", rep.token, workspace.id)
        .send({
          companyId: crm.company.id,
          dealId: crm.deal.id,
          ownerId: rep.id,
          items: [{ name: "Subscription", quantity: 3, unitPrice: "100" }]
        })
        .expect(201)
    ).body as OrderDto;
    const hidden = (await api("get", "/api/orders", otherRep.token, workspace.id).expect(200))
      .body as PaginatedResponse<OrderDto>;
    expect(hidden.items).toHaveLength(0);
    await api("patch", `/api/orders/${created.id}`, otherRep.token, workspace.id)
      .send({ paymentStatus: "PAID" })
      .expect(403);
    const updated = (
      await api("patch", `/api/orders/${created.id}`, manager.token, workspace.id)
        .send({
          paymentStatus: "PAID",
          fulfillmentStatus: "FULFILLED"
        })
        .expect(200)
    ).body as OrderDto;
    expect(updated.paymentStatus).toBe("PAID");
    expect(updated.fulfillmentStatus).toBe("FULFILLED");
    expect(updated.paidAt).not.toBeNull();
    expect(updated.fulfilledAt).not.toBeNull();
    const summary = (
      await api("get", "/api/orders/summary", manager.token, workspace.id).expect(200)
    ).body as OrderSummaryDto;
    expect(summary.totalOrders).toBe(1);
    expect(summary.fulfilledToday).toBe(1);
    expect(summary.revenueToday).toBe("300.00");
  });
});
