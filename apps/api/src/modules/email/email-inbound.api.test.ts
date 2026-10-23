import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus, WorkspaceMemberStatus, WorkspaceRole } from "@prisma/client";
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
  AWS_SES_TIMEOUT_MS: process.env.AWS_SES_TIMEOUT_MS,
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
      status: UserStatus.ACTIVE,
      workspaceMemberships: {
        create: {
          workspaceId: workspace.id,
          role: WorkspaceRole.ADMIN,
          status: WorkspaceMemberStatus.ACTIVE
        }
      }
    }
  });
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({
    data: { workspaceId: workspace.id, name: "R6 API Company" }
  });
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
    process.env.AWS_SES_TIMEOUT_MS = originalSesEnv.AWS_SES_TIMEOUT_MS;
    process.env.E2E_INBOUND_EMAIL_WEBHOOK_SECRET = originalSesEnv.E2E_INBOUND_EMAIL_WEBHOOK_SECRET;
    await cleanup();
    await prisma.$disconnect();
  });

  it("rejects unsigned inbound webhooks", async () => {
    await request(app).post("/api/email/inbound").send({}).expect(401);
  });

  it.each([
    { name: "client reply", headers: [], textBody: "API inbound body", skipped: false },
    {
      name: "automatic receipt",
      headers: [{ name: "Auto-Submitted", value: "auto-generated" }],
      textBody: "Your message was received.",
      skipped: true
    },
    {
      name: "client reply quoting OOO",
      headers: [],
      textBody: "Please send pricing.\n> I am out of the office.",
      skipped: false
    }
  ])(
    "accepts a signed $name and records processing truthfully",
    async ({ headers, textBody, skipped }) => {
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
          headers: [{ name: "X-Shilabs-Lead-Id", value: leadId }, ...headers]
        },
        receipt: { action: { type: "SNS" } },
        textBody
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
      expect(body.inboundEmail.replyProcessingStatus).toBe(skipped ? "SKIPPED" : "PENDING");
      expect(body.inboundEmail.failureCode).toBeNull();
      await expect(
        prisma.message.findUnique({ where: { providerMessageId: "ses-r6-api-success" } })
      ).resolves.toMatchObject({
        body: textBody,
        metadata: {
          inboundClassification: { version: 1, kind: skipped ? "NONMEANINGFUL" : "MEANINGFUL" }
        }
      });
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.automationOwnershipState === "HUMAN_REQUIRED").toBe(!skipped);
    }
  );

  it.each(["development", "e2e-local"])(
    "lets an admin submit a local customer reply through the signed inbound boundary in %s",
    async (appEnv) => {
      const leadId = await createLead();
      const token = await login();
      process.env.AWS_SES_TIMEOUT_MS = "0";
      process.env.APP_ENV = appEnv;
      delete process.env.AWS_SES_WEBHOOK_SECRET;
      delete process.env.E2E_INBOUND_EMAIL_WEBHOOK_SECRET;

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
      await expect(prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).resolves.toMatchObject(
        {
          automationOwnershipState: "HUMAN_REQUIRED"
        }
      );
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
    }
  );

  it("does not expose the local customer reply helper in production", async () => {
    const leadId = await createLead();
    const token = await login();
    process.env.APP_ENV = "production";

    await request(app)
      .post("/api/email/e2e/customer-reply")
      .set("Authorization", `Bearer ${token}`)
      .send({ leadId, body: "Not available outside local E2E." })
      .expect(404);
  });

  it("does not allow local customer replies for another workspace", async () => {
    const leadId = await createLead();
    const token = await login();
    const workspace = await prisma.workspace.create({
      data: { name: "Inbound isolation", slug: `inbound-isolation-${crypto.randomUUID()}` }
    });
    try {
      await prisma.lead.update({ where: { id: leadId }, data: { workspaceId: workspace.id } });
      await request(app)
        .post("/api/email/e2e/customer-reply")
        .set("Authorization", `Bearer ${token}`)
        .send({ leadId, body: "Please send the proposal." })
        .expect(403);
      expect(await prisma.inboundEmail.count({ where: { leadId } })).toBe(0);
    } finally {
      const original = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
      await prisma.lead.update({ where: { id: leadId }, data: { workspaceId: original.id } });
      await prisma.workspace.delete({ where: { id: workspace.id } });
    }
  });
});
