import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import type { SesInboundEmailDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "r6-inbound-api-admin@example.local";
const webhookSecret = "api-webhook-secret";
const originalSesEnv = {
  AWS_SES_REGION: process.env.AWS_SES_REGION,
  AWS_SES_FROM_EMAIL: process.env.AWS_SES_FROM_EMAIL,
  AWS_SES_ACCESS_KEY_ID: process.env.AWS_SES_ACCESS_KEY_ID,
  AWS_SES_SECRET_ACCESS_KEY: process.env.AWS_SES_SECRET_ACCESS_KEY,
  AWS_SES_WEBHOOK_SECRET: process.env.AWS_SES_WEBHOOK_SECRET
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
    where: { providerMessageId: { startsWith: "ses-r6-api-" } }
  });
  await prisma.emailProviderEvent.deleteMany({
    where: { providerMessageId: { startsWith: "ses-r6-api-" } }
  });
  await prisma.message.deleteMany({
    where: { providerMessageId: { startsWith: "ses-r6-api-" } }
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
  const company = await prisma.company.create({ data: { name: "R6 API Company" } });
  const contact = await prisma.contact.create({
    data: {
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
      companyId: company.id,
      contactId: contact.id,
      ownerId: user.id,
      source: "r6-inbound-api-test",
      stageId: stage.id
    }
  });
  return lead.id;
}

describe("SES inbound email API", () => {
  beforeEach(async () => {
    process.env.AWS_SES_REGION = "us-east-1";
    process.env.AWS_SES_FROM_EMAIL = "sales@example.com";
    process.env.AWS_SES_ACCESS_KEY_ID = "test-access-key";
    process.env.AWS_SES_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.AWS_SES_WEBHOOK_SECRET = webhookSecret;
    await cleanup();
  });

  afterAll(async () => {
    process.env.AWS_SES_REGION = originalSesEnv.AWS_SES_REGION;
    process.env.AWS_SES_FROM_EMAIL = originalSesEnv.AWS_SES_FROM_EMAIL;
    process.env.AWS_SES_ACCESS_KEY_ID = originalSesEnv.AWS_SES_ACCESS_KEY_ID;
    process.env.AWS_SES_SECRET_ACCESS_KEY = originalSesEnv.AWS_SES_SECRET_ACCESS_KEY;
    process.env.AWS_SES_WEBHOOK_SECRET = originalSesEnv.AWS_SES_WEBHOOK_SECRET;
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
});
