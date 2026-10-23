import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus, WorkspaceRole } from "@prisma/client";
import type { AuthResponse, InternalNotificationDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const password = "CorrectHorse123!";
process.env.JWT_SECRET = "r27-notification-test-secret-32-chars-min";
const adminEmail = "r27-notifications-admin@example.local";
const repEmail = "r27-notifications-rep@example.local";
const otherRepEmail = "r27-notifications-other@example.local";

async function cleanup(): Promise<void> {
  await prisma.domainEventOutbox.deleteMany({
    where: { aggregateType: "InternalNotification" }
  });
  await prisma.auditEvent.deleteMany({
    where: { entityType: "InternalNotification" }
  });
  await prisma.internalNotification.deleteMany({
    where: { idempotencyKey: { startsWith: "r27-notification:" } }
  });
  await prisma.authSession.deleteMany({
    where: { user: { email: { in: [adminEmail, repEmail, otherRepEmail] } } }
  });
  await prisma.user.deleteMany({
    where: { email: { in: [adminEmail, repEmail, otherRepEmail] } }
  });
}

async function seedUsers(): Promise<{ adminId: string; repId: string; otherRepId: string }> {
  const passwordHash = await hashPassword(password);
  const [admin, rep, otherRep] = await Promise.all([
    prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: "R27",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    }),
    prisma.user.create({
      data: {
        email: repEmail,
        passwordHash,
        firstName: "R27",
        lastName: "Rep",
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE
      }
    }),
    prisma.user.create({
      data: {
        email: otherRepEmail,
        passwordHash,
        firstName: "R27",
        lastName: "Other",
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE
      }
    })
  ]);
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: workspace.id, userId: admin.id, role: WorkspaceRole.ADMIN, status: "ACTIVE" },
      {
        workspaceId: workspace.id,
        userId: rep.id,
        role: WorkspaceRole.SALES_REP,
        status: "ACTIVE"
      },
      {
        workspaceId: workspace.id,
        userId: otherRep.id,
        role: WorkspaceRole.SALES_REP,
        status: "ACTIVE"
      }
    ]
  });
  return { adminId: admin.id, repId: rep.id, otherRepId: otherRep.id };
}

async function login(email: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.body as AuthResponse).accessToken;
}

async function createNotification(assignedToUserId: string): Promise<string> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const notification = await prisma.internalNotification.create({
    data: {
      workspaceId: workspace.id,
      type: "MEETING_CONFIRMATION",
      status: "UNREAD",
      severity: "WARNING",
      title: "R27 notification",
      body: "Notification requires action",
      assignedToUserId,
      sourceEntityType: "R27Test",
      sourceEntityId: "r27-source-1",
      idempotencyKey: "r27-notification:source-1"
    }
  });
  return notification.id;
}

describe("R27 notification API", () => {
  beforeEach(async () => {
    await cleanup();
  }, 180000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 180000);

  it("enforces RBAC visibility for assigned notifications", async () => {
    const { repId } = await seedUsers();
    await createNotification(repId);
    const repToken = await login(repEmail);
    const otherToken = await login(otherRepEmail);

    const visible = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${repToken}`)
      .expect(200);
    const hidden = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(200);

    expect(visible.body as InternalNotificationDto[]).toHaveLength(1);
    expect(hidden.body as InternalNotificationDto[]).toHaveLength(0);
  });

  it("does not expose notifications from another workspace", async () => {
    const { adminId, repId } = await seedUsers();
    const otherWorkspace = await prisma.workspace.create({
      data: { name: "R27 Isolated Workspace", slug: `r27-isolated-${String(Date.now())}` }
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: otherWorkspace.id,
        userId: adminId,
        role: WorkspaceRole.ADMIN,
        status: "ACTIVE"
      }
    });
    const foreignNotification = await prisma.internalNotification.create({
      data: {
        workspaceId: otherWorkspace.id,
        type: "MEETING_CONFIRMATION",
        status: "UNREAD",
        severity: "WARNING",
        title: "Other workspace notification",
        body: "Must remain isolated",
        assignedToUserId: repId,
        sourceEntityType: "R27Test",
        sourceEntityId: "r27-other-workspace",
        idempotencyKey: "r27-notification:other-workspace"
      }
    });

    const adminToken = await login(adminEmail);
    const visible = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(visible.body as InternalNotificationDto[]).toHaveLength(0);
    for (const action of ["read", "acknowledge", "escalate"]) {
      await request(app)
        .patch(`/api/notifications/${foreignNotification.id}/${action}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send(action === "escalate" ? { reason: "Must not change another workspace" } : {})
        .expect(404);
    }
    await expect(
      prisma.internalNotification.findUniqueOrThrow({ where: { id: foreignNotification.id } })
    ).resolves.toMatchObject({ status: "UNREAD", readAt: null, acknowledgedAt: null });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: otherWorkspace.id } });
    await prisma.internalNotification.deleteMany({ where: { workspaceId: otherWorkspace.id } });
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } });
  });

  it("marks notifications read and acknowledged idempotently with evidence", async () => {
    const { repId } = await seedUsers();
    const id = await createNotification(repId);
    const repToken = await login(repEmail);

    const readResponse = await request(app)
      .patch(`/api/notifications/${id}/read`)
      .set("Authorization", `Bearer ${repToken}`)
      .expect(200);
    expect((readResponse.body as InternalNotificationDto).status).toBe("READ");

    const acknowledged = await request(app)
      .patch(`/api/notifications/${id}/acknowledge`)
      .set("Authorization", `Bearer ${repToken}`)
      .send({ note: "Handling this item" })
      .expect(200);
    const repeated = await request(app)
      .patch(`/api/notifications/${id}/acknowledge`)
      .set("Authorization", `Bearer ${repToken}`)
      .send({ note: "Handling this item" })
      .expect(200);

    expect((acknowledged.body as InternalNotificationDto).status).toBe("ACKNOWLEDGED");
    expect((repeated.body as InternalNotificationDto).acknowledgedAt).toBe(
      (acknowledged.body as InternalNotificationDto).acknowledgedAt
    );
    await expect(
      prisma.auditEvent.count({ where: { entityId: id, action: "NOTIFICATION_ACKNOWLEDGED" } })
    ).resolves.toBe(1);
    await expect(
      prisma.domainEventOutbox.count({
        where: { aggregateId: id, eventType: "NOTIFICATION_ACKNOWLEDGED" }
      })
    ).resolves.toBe(1);
  });

  it("allows managers to escalate notifications with a durable delivery request", async () => {
    const { repId } = await seedUsers();
    const id = await createNotification(repId);
    const adminToken = await login(adminEmail);

    const response = await request(app)
      .patch(`/api/notifications/${id}/escalate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Needs manager attention" })
      .expect(200);

    const notification = response.body as InternalNotificationDto;
    expect(notification.status).toBe("ESCALATED");
    expect(notification.severity).toBe("CRITICAL");
    expect(notification.escalationStatus).toBe("ESCALATED");
    expect(notification.escalationReason).toBe("Needs manager attention");
    expect(notification.escalationEvidence).toMatchObject({
      delivery: { state: "Pending", channel: "EMAIL" }
    });
    await expect(
      prisma.domainEventOutbox.count({
        where: { aggregateId: id, eventType: "NOTIFICATION_ESCALATED" }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.auditEvent.count({ where: { entityId: id, action: "NOTIFICATION_ESCALATED" } })
    ).resolves.toBe(1);
  });
});
