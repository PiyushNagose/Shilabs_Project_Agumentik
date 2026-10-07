import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, SesInboundEmailDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "r6-inbound-api-admin@example.local";
const webhookSecret = "api-webhook-secret";
const originalSesEnv = {
  APP_ENV: process.env.APP_ENV,
  NODE_ENV: process.env.NODE_ENV,
  AWS_SES_REGION: process.env.AWS_SES_REGION,
  AWS_SES_FROM_EMAIL: process.env.AWS_SES_FROM_EMAIL,
  AWS_SES_ACCESS_KEY_ID: process.env.AWS_SES_ACCESS_KEY_ID,
  AWS_SES_SECRET_ACCESS_KEY: process.env.AWS_SES_SECRET_ACCESS_KEY,
  AWS_SES_WEBHOOK_SECRET: process.env.AWS_SES_WEBHOOK_SECRET,
  E2E_INBOUND_EMAIL_WEBHOOK_SECRET: process.env.E2E_INBOUND_EMAIL_WEBHOOK_SECRET
};

function sign(rawBody: string): { timestamp: string; signature: string } {
  const timestamp = String(Date.now());
  const signature = `sha256=${crypto
    .createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
  return { timestamp, signature };
}

async function cleanup(): Promise<void> {
  await prisma.inboundEmail.deleteMany({
    where: {
      OR: [
        { providerMessageId: { startsWith: "ses-r6-api-" } },
        { providerMessageId: { startsWith: "e2e-customer-reply-" } }
      ]
    }
  });
  await prisma.emailProviderEvent.deleteMany({
    where: {
      OR: [
        { providerMessageId: { startsWith: "ses-r6-api-" } },
        { providerMessageId: { startsWith: "e2e-customer-reply-" } }
      ]
    }
  });
  await prisma.message.deleteMany({
    where: {
      OR: [
        { providerMessageId: { startsWith: "ses-r6-api-" } },
        { providerMessageId: { startsWith: "e2e-customer-reply-" } }
      ]
    }
  });
  await prisma.conversation.deleteMany({
    where: { lead: { source: "r6-inbound-api-test" } }
  });
  await prisma.activity.deleteMany({
    where: { lead: { source: "r6-inbound-api-test" } }
  });
  await prisma.lead.deleteMany({ where: { source: "r6-inbound-api-test" } });
  await prisma.contact.deleteMany({ where: { source: "r6-inbound-api-test" } });
  await prisma.company.deleteMany({ where: { name: "R6 API Company" } });
  await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

async function createLead(): Promise<string> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const user = await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: "Inbound",
      lastName: "API",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({ data: { workspaceId: workspace.id, name: "R6 API Company" } });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "API",
      lastName: "Reply",
      email: "r6-api@example.com",
      normalizedEmail: "r6-api@example.com",
      source: "r6-inbound-api-test"
    }
  });
  const lead = await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      ownerId: user.id,
      source: "r6-inbound-api-test",
      stageId: stage.id
    }
  });
  return lead.id;
}

async function login(): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: adminEmail, password: "CorrectHorse123!" })
    .expect(200);
  return (response.body as unknown as AuthResponse).accessToken;
}

describe("SES inbound email API", () => {
  beforeEach(async () => {
    process.env.APP_ENV = "e2e-local";
    process.env.NODE_ENV = "test";
    process.env.AWS_SES_REGION = "us-east-1";
    process.env.AWS_SES_FROM_EMAIL = "sales@example.com";
    process.env.AWS_SES_ACCESS_KEY_ID = "test-access-key";
    process.env.AWS_SES_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.AWS_SES_WEBHOOK_SECRET = webhookSecret;
    process.env.E2E_INBOUND_EMAIL_WEBHOOK_SECRET = webhookSecret;
    await cleanup();
  });

  afterAll(async () => {
    process.env.APP_ENV = originalSesEnv.APP_ENV;
    process.env.NODE_ENV = originalSesEnv.NODE_ENV;
    process.env.AWS_SES_REGION = originalSesEnv.AWS_SES_REGION;
    process.env.AWS_SES_FROM_EMAIL = originalSesEnv.AWS_SES_FROM_EMAIL;
    process.env.AWS_SES_ACCESS_KEY_ID = originalSesEnv.AWS_SES_ACCESS_KEY_ID;
    process.env.AWS_SES_SECRET_ACCESS_KEY = originalSesEnv.AWS_SES_SECRET_ACCESS_KEY;
    process.env.AWS_SES_WEBHOOK_SECRET = originalSesEnv.AWS_SES_WEBHOOK_SECRET;
    process.env.E2E_INBOUND_EMAIL_WEBHOOK_SECRET = originalSesEnv.E2E_INBOUND_EMAIL_WEBHOOK_SECRET;
    await cleanup();
    await prisma.$disconnect();
  });

  it("rejects unsigned inbound webhooks", async () => {
    await request(app).post("/api/email/inbound").send({}).expect(401);
  });

  it("accepts signed inbound SES webhooks and persists the inbound message", async () => {
    const leadId = await createLead();
    const payload = {
      notificationType: "Received",
      mail: {
        messageId: "ses-r6-api-success",
        timestamp: new Date().toISOString(),
        source: "r6-api@example.com",
        destination: ["sales@example.com"],
        commonHeaders: {
          from: ["r6-api@example.com"],
          to: ["sales@example.com"],
          subject: "API reply"
        },
        headers: [{ name: "X-Shilabs-Lead-Id", value: leadId }]
      },
      receipt: { action: { type: "SNS" } },
      textBody: "API inbound body"
    };
    const rawBody = JSON.stringify(payload);
    const signed = sign(rawBody);

    const response = await request(app)
      .post("/api/email/inbound")
      .set("x-shilabs-webhook-timestamp", signed.timestamp)
      .set("x-shilabs-webhook-signature", signed.signature)
      .send(payload)
      .expect(200);
    const body = response.body as unknown as SesInboundEmailDto;

    expect(body.status).toBe("PROCESSED");
    expect(body.inboundEmail.leadId).toBe(leadId);
    await expect(
      prisma.message.findUnique({ where: { providerMessageId: "ses-r6-api-success" } })
    ).resolves.toMatchObject({ body: "API inbound body" });
  });

  it("lets an admin submit a local E2E customer reply through the signed inbound boundary", async () => {
    const leadId = await createLead();
    const token = await login();

    const response = await request(app)
      .post("/api/email/e2e/customer-reply")
      .set("Authorization", `Bearer ${token}`)
      .send({
        leadId,
        subject: "E2E reply",
        body: "This is a real local E2E customer reply."
      })
      .expect(200);
    const body = response.body as unknown as SesInboundEmailDto;

    expect(body.status).toBe("PROCESSED");
    expect(body.inboundEmail.leadId).toBe(leadId);
    expect(body.inboundEmail.replyProcessingStatus).toBe("PENDING");
    expect(body.inboundEmail.providerMessageId).toMatch(/^e2e-customer-reply-/);
    await expect(
      prisma.message.findUnique({
        where: { providerMessageId: body.inboundEmail.providerMessageId }
      })
    ).resolves.toMatchObject({
      body: "This is a real local E2E customer reply.",
      direction: "INBOUND",
      senderType: "PROSPECT"
    });
    await expect(
      prisma.emailProviderEvent.findFirst({
        where: {
          providerMessageId: body.inboundEmail.providerMessageId,
          type: "INBOUND_RECEIVED"
        }
      })
    ).resolves.toBeTruthy();
  });

  it("does not expose the local E2E customer reply helper outside e2e-local", async () => {
    const leadId = await createLead();
    const token = await login();
    process.env.APP_ENV = "development";

    await request(app)
      .post("/api/email/e2e/customer-reply")
      .set("Authorization", `Bearer ${token}`)
      .send({ leadId, body: "Not available outside local E2E." })
      .expect(404);
  });
});
