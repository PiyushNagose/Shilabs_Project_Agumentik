import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus, WorkspaceRole } from "@prisma/client";
import type { AuthResponse, OperationsDashboardDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

process.env.JWT_SECRET = "r28-operations-test-secret-32-chars-min";
process.env.AI_PROVIDER = "";
process.env.SEMRUSH_API_KEY = "";
process.env.CALENDAR_PROVIDER = "none";
process.env.VOICE_PROVIDER = "none";
process.env.MESSAGING_PROVIDER = "none";
process.env.EMAIL_PROVIDER = "AWS_SES";
process.env.AWS_SES_REGION = "";
process.env.ZOHO_BIGIN_CLIENT_ID = "";
process.env.ZOHO_BIGIN_CLIENT_SECRET = "";
process.env.ZOHO_BIGIN_REFRESH_TOKEN = "";

const app = createApp();
const password = "CorrectHorse123!";
const adminEmail = "r28-operations-admin@example.local";
const operationsEmail = "r28-operations-operator@example.local";
const viewerEmail = "r28-operations-viewer@example.local";
const testEmails = [adminEmail, operationsEmail, viewerEmail];
const workspaceSlugs = ["r28-operations-a", "r28-operations-b"] as const;

async function cleanup(): Promise<void> {
  await prisma.emailProviderEvent.deleteMany({
    where: { providerEventId: { startsWith: "r28-operations:" } }
  });
  await prisma.domainEventOutbox.deleteMany({
    where: { idempotencyKey: { startsWith: "r28-operations:" } }
  });
  await prisma.externalRecordMapping.deleteMany({
    where: { idempotencyKey: { startsWith: "r28-operations:" } }
  });
  await prisma.integrationAccount.deleteMany({
    where: { key: { startsWith: "r28-operations" } }
  });
  await prisma.authSession.deleteMany({
    where: { user: { email: { in: testEmails } } }
  });
  await prisma.workspace.deleteMany({ where: { slug: { in: [...workspaceSlugs] } } });
  await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
}

async function seedAccessModel(): Promise<{ workspaceAId: string; workspaceBId: string }> {
  const passwordHash = await hashPassword(password);
  const [admin, operator, viewer, workspaceA, workspaceB] = await prisma.$transaction([
    prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: "R28",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    }),
    prisma.user.create({
      data: {
        email: operationsEmail,
        passwordHash,
        firstName: "R28",
        lastName: "Operator",
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE
      }
    }),
    prisma.user.create({
      data: {
        email: viewerEmail,
        passwordHash,
        firstName: "R28",
        lastName: "Viewer",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    }),
    prisma.workspace.create({ data: { name: "R28 Operations A", slug: workspaceSlugs[0] } }),
    prisma.workspace.create({ data: { name: "R28 Operations B", slug: workspaceSlugs[1] } })
  ]);

  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: workspaceA.id, userId: admin.id, role: WorkspaceRole.ADMIN },
      { workspaceId: workspaceB.id, userId: admin.id, role: WorkspaceRole.ADMIN },
      { workspaceId: workspaceA.id, userId: operator.id, role: WorkspaceRole.OPERATIONS },
      { workspaceId: workspaceA.id, userId: viewer.id, role: WorkspaceRole.VIEWER }
    ]
  });

  return { workspaceAId: workspaceA.id, workspaceBId: workspaceB.id };
}

async function login(email: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.body as AuthResponse).accessToken;
}

function getDashboard(token: string, workspaceId: string) {
  return request(app)
    .get("/api/operations/dashboard")
    .set("Authorization", `Bearer ${token}`)
    .set("x-workspace-id", workspaceId);
}

async function seedOperationalEvidence(workspaceId: string, marker: string): Promise<void> {
  const account = await prisma.integrationAccount.create({
    data: {
      workspaceId,
      provider: "ZOHO_BIGIN",
      key: `r28-operations-${marker}`,
      displayName: `R28 Zoho ${marker}`,
      status: "ERROR",
      lastError: `R28 ${marker} sync account requires attention`
    }
  });
  await prisma.externalRecordMapping.create({
    data: {
      workspaceId,
      integrationAccountId: account.id,
      provider: "ZOHO_BIGIN",
      entityType: "LEAD",
      localEntityId: `r28-local-lead-${marker}`,
      externalRecordId: `r28-external-lead-${marker}`,
      syncStatus: "FAILED",
      lastErrorCode: `R28_${marker.toUpperCase()}_SYNC_FAILED`,
      lastErrorMessage: `R28 ${marker} mapping failed to sync`,
      idempotencyKey: `r28-operations:mapping:${marker}`
    }
  });
  await prisma.domainEventOutbox.create({
    data: {
      workspaceId,
      eventType: `R28_${marker.toUpperCase()}_TEST_EVENT`,
      aggregateType: "R28Test",
      aggregateId: `r28-test-aggregate-${marker}`,
      payload: {},
      status: "ATTENTION_REQUIRED",
      correlationId: `r28-operations-correlation-${marker}`,
      idempotencyKey: `r28-operations:event:${marker}`,
      lastErrorCode: `R28_${marker.toUpperCase()}_ATTENTION`,
      lastErrorMessage: `R28 ${marker} event needs attention`
    }
  });
  await prisma.emailProviderEvent.create({
    data: {
      workspaceId,
      provider: "AWS_SES",
      providerEventId: `r28-operations:email:${marker}`,
      type: "DELIVERY",
      payload: { marker }
    }
  });
}

function usageCount(dashboard: OperationsDashboardDto, key: string): number | undefined {
  return dashboard.usage.find((item) => item.key === key)?.count;
}

describe("R28 operations dashboard API", () => {
  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("allows operations members while rejecting unauthenticated users and viewers", async () => {
    const { workspaceAId } = await seedAccessModel();
    const operationsToken = await login(operationsEmail);
    const viewerToken = await login(viewerEmail);

    await request(app).get("/api/operations/dashboard").expect(401);
    await getDashboard(viewerToken, workspaceAId).expect(403);
    await getDashboard(operationsToken, workspaceAId).expect(200);
  });

  it("isolates failed work, mappings, provider errors and usage by active workspace", async () => {
    const { workspaceAId, workspaceBId } = await seedAccessModel();
    await seedOperationalEvidence(workspaceAId, "alpha");
    await seedOperationalEvidence(workspaceBId, "beta");
    const adminToken = await login(adminEmail);

    const responseA = await getDashboard(adminToken, workspaceAId).expect(200);
    const dashboardA = responseA.body as OperationsDashboardDto;
    expect(dashboardA.work.attentionRequiredCount).toBe(1);
    expect(dashboardA.work.recentProblemItems.map((item) => item.detail)).toEqual([
      "R28 alpha event needs attention"
    ]);
    expect(dashboardA.unsyncedRecords.total).toBe(1);
    expect(dashboardA.providerErrors.some((item) => item.message.includes("alpha"))).toBe(true);
    expect(dashboardA.providerErrors.some((item) => item.message.includes("beta"))).toBe(false);
    expect(usageCount(dashboardA, "email-events-24h")).toBe(1);

    const responseB = await getDashboard(adminToken, workspaceBId).expect(200);
    const dashboardB = responseB.body as OperationsDashboardDto;
    expect(dashboardB.work.attentionRequiredCount).toBe(1);
    expect(dashboardB.work.recentProblemItems.map((item) => item.detail)).toEqual([
      "R28 beta event needs attention"
    ]);
    expect(dashboardB.unsyncedRecords.total).toBe(1);
    expect(dashboardB.providerErrors.some((item) => item.message.includes("beta"))).toBe(true);
    expect(dashboardB.providerErrors.some((item) => item.message.includes("alpha"))).toBe(false);
    expect(usageCount(dashboardB, "email-events-24h")).toBe(1);
  });
});
