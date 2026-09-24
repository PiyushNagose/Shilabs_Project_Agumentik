import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
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
const repEmail = "r28-operations-rep@example.local";

async function cleanup(): Promise<void> {
  await prisma.domainEventOutbox.deleteMany({
    where: { idempotencyKey: { startsWith: "r28-operations:" } }
  });
  await prisma.externalRecordMapping.deleteMany({
    where: { idempotencyKey: { startsWith: "r28-operations:" } }
  });
  await prisma.integrationAccount.deleteMany({
    where: { key: "r28-operations" }
  });
  await prisma.authSession.deleteMany({
    where: { user: { email: { in: [adminEmail, repEmail] } } }
  });
  await prisma.user.deleteMany({
    where: { email: { in: [adminEmail, repEmail] } }
  });
}

async function seedUsers(): Promise<void> {
  const passwordHash = await hashPassword(password);
  await prisma.user.createMany({
    data: [
      {
        email: adminEmail,
        passwordHash,
        firstName: "R28",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      },
      {
        email: repEmail,
        passwordHash,
        firstName: "R28",
        lastName: "Rep",
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE
      }
    ]
  });
}

async function login(email: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.body as AuthResponse).accessToken;
}

async function seedOperationalEvidence(): Promise<void> {
  const account = await prisma.integrationAccount.create({
    data: {
      provider: "ZOHO_BIGIN",
      key: "r28-operations",
      displayName: "R28 Zoho Test",
      status: "ERROR",
      lastError: "R28 sync account requires attention"
    }
  });
  await prisma.externalRecordMapping.create({
    data: {
      integrationAccountId: account.id,
      provider: "ZOHO_BIGIN",
      entityType: "LEAD",
      localEntityId: "r28-local-lead",
      externalRecordId: "r28-external-lead",
      syncStatus: "FAILED",
      lastErrorCode: "R28_SYNC_FAILED",
      lastErrorMessage: "R28 mapping failed to sync",
      idempotencyKey: "r28-operations:mapping"
    }
  });
  await prisma.domainEventOutbox.create({
    data: {
      eventType: "R28_TEST_EVENT",
      aggregateType: "R28Test",
      aggregateId: "r28-test-aggregate",
      payload: {},
      status: "ATTENTION_REQUIRED",
      correlationId: "r28-operations-correlation",
      idempotencyKey: "r28-operations:event",
      lastErrorCode: "R28_ATTENTION",
      lastErrorMessage: "R28 event needs attention"
    }
  });
}

describe("R28 operations dashboard API", () => {
  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("requires admin or manager access", async () => {
    await seedUsers();
    const repToken = await login(repEmail);

    await request(app).get("/api/operations/dashboard").expect(401);
    await request(app)
      .get("/api/operations/dashboard")
      .set("Authorization", `Bearer ${repToken}`)
      .expect(403);
  });

  it("aggregates provider health, failed work, unsynced mappings and truthful usage", async () => {
    await seedUsers();
    await seedOperationalEvidence();
    const adminToken = await login(adminEmail);

    const response = await request(app)
      .get("/api/operations/dashboard")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const dashboard = response.body as OperationsDashboardDto;

    expect(dashboard.providerHealth.map((item) => item.key)).toEqual([
      "zoho",
      "email",
      "ai",
      "semrush",
      "whatsapp",
      "voice",
      "calendar"
    ]);
    expect(dashboard.work.attentionRequiredCount).toBeGreaterThanOrEqual(1);
    expect(dashboard.work.recentProblemItems.some((item) => item.id)).toBe(true);
    expect(dashboard.unsyncedRecords.total).toBeGreaterThanOrEqual(1);
    expect(
      dashboard.providerErrors.some((item) => item.message === "R28 mapping failed to sync")
    ).toBe(true);
    expect(dashboard.usage.length).toBeGreaterThan(0);
    expect(dashboard.usage.every((item) => item.costAmount === null)).toBe(true);
    expect(dashboard.usage.every((item) => item.costUnavailableReason)).toBe(true);
  });
});
