import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import { ingestSesInboundEmail } from "./email.service.js";

const actorEmail = "r6-inbound-admin@example.local";
const configuredEnv = {
  AWS_SES_REGION: "us-east-1",
  AWS_SES_FROM_EMAIL: "sales@example.com",
  AWS_SES_ACCESS_KEY_ID: "test-access-key",
  AWS_SES_SECRET_ACCESS_KEY: "test-secret-key",
  AWS_SES_WEBHOOK_SECRET: "test-webhook-secret",
  AWS_SES_USE_DEFAULT_CREDENTIAL_CHAIN: "false"
};

function sign(body: unknown): { rawBody: string; timestamp: string; signature: string } {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Date.now());
  const signature = `sha256=${crypto
    .createHmac("sha256", configuredEnv.AWS_SES_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
  return { rawBody, timestamp, signature };
}

async function cleanup(): Promise<void> {
  await prisma.inboundEmail.deleteMany({
    where: {
      OR: [
        { providerMessageId: { startsWith: "ses-r6-" } },
        { normalizedFromEmail: { contains: "r6-" } }
      ]
    }
  });
  await prisma.emailProviderEvent.deleteMany({
    where: {
      OR: [
        { providerEventId: { startsWith: "r6-" } },
        { providerMessageId: { startsWith: "ses-r6-" } }
      ]
    }
  });
  await prisma.message.deleteMany({
    where: { providerMessageId: { startsWith: "ses-r6-" } }
  });
  await prisma.conversation.deleteMany({
    where: { lead: { source: { startsWith: "r6-" } } }
  });
  await prisma.activity.deleteMany({
    where: { lead: { source: { startsWith: "r6-" } } }
  });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { action: { in: ["EMAIL_REPLY_RECEIVED", "REPLY_PROCESSING_TRIGGERED"] } },
        { actorId: actorId }
      ]
    }
  });
  await prisma.lead.deleteMany({ where: { source: { startsWith: "r6-" } } });
  await prisma.contact.deleteMany({ where: { source: { startsWith: "r6-" } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: "R6 " } } });
  await prisma.authSession.deleteMany({ where: { user: { email: actorEmail } } });
  await prisma.user.deleteMany({ where: { email: actorEmail } });
}

let actorId: string | undefined;

async function createLead(email: string, suffix: string = crypto.randomUUID()) {
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({
    data: {
      name: `R6 Company ${suffix}`
    }
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "R6",
      lastName: "Reply",
      email,
      normalizedEmail: email.toLowerCase(),
      source: "r6-inbound-test"
    }
  });
  return prisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      ownerId: actorId,
      source: "r6-inbound-test",
      stageId: stage.id
    },
    include: { contact: true }
  });
}

function inboundPayload(input: {
  providerMessageId: string;
  from: string;
  subject?: string;
  leadId?: string;
}): unknown {
  const headers = [
    { name: "From", value: input.from },
    { name: "Subject", value: input.subject ?? "Interested" }
  ];
  if (input.leadId) {
    headers.push({ name: "X-Shilabs-Lead-Id", value: input.leadId });
  }

  return {
    notificationType: "Received",
    mail: {
      messageId: input.providerMessageId,
      timestamp: new Date().toISOString(),
      source: input.from,
      destination: ["sales@example.com"],
      commonHeaders: {
        from: [input.from],
        to: ["sales@example.com"],
        subject: input.subject ?? "Interested"
      },
      headers
    },
    receipt: {
      action: { type: "SNS" }
    },
    textBody: "Yes, please share more details."
  };
}

describe("SES inbound email ingestion", () => {
  beforeAll(async () => {
    await cleanup();
    const user = await prisma.user.create({
      data: {
        email: actorEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "Inbound",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });
    actorId = user.id;
  });

  beforeEach(async () => {
    await prisma.inboundEmail.deleteMany();
    await prisma.emailProviderEvent.deleteMany({
      where: { type: "INBOUND_RECEIVED" }
    });
    await prisma.message.deleteMany({
      where: { providerMessageId: { startsWith: "ses-r6-" } }
    });
    await prisma.conversation.deleteMany({
      where: { lead: { source: { startsWith: "r6-" } } }
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("threads inbound email into the matching lead email conversation and triggers reply processing", async () => {
    const lead = await createLead("r6-success@example.com");
    const payload = inboundPayload({
      providerMessageId: "ses-r6-success",
      from: "R6 Prospect <r6-success@example.com>",
      leadId: lead.id
    });
    const signed = sign(payload);

    const result = await ingestSesInboundEmail({
      body: payload,
      rawBody: signed.rawBody,
      headers: { signature: signed.signature, timestamp: signed.timestamp },
      env: configuredEnv
    });

    expect(result.status).toBe("PROCESSED");
    expect(result.inboundEmail.leadId).toBe(lead.id);
    expect(result.inboundEmail.replyProcessingStatus).toBe("PENDING");
    await expect(
      prisma.message.findUnique({ where: { providerMessageId: "ses-r6-success" } })
    ).resolves.toMatchObject({
      direction: "INBOUND",
      senderType: "PROSPECT",
      body: "Yes, please share more details."
    });
    await expect(prisma.emailProviderEvent.count({ where: { type: "INBOUND_RECEIVED" } })).resolves.toBe(1);
  });

  it("deduplicates inbound provider message IDs", async () => {
    const lead = await createLead("r6-duplicate@example.com");
    const payload = inboundPayload({
      providerMessageId: "ses-r6-duplicate",
      from: "r6-duplicate@example.com",
      leadId: lead.id
    });
    const signed = sign(payload);

    const first = await ingestSesInboundEmail({
      body: payload,
      rawBody: signed.rawBody,
      headers: { signature: signed.signature, timestamp: signed.timestamp },
      env: configuredEnv
    });
    const second = await ingestSesInboundEmail({
      body: payload,
      rawBody: signed.rawBody,
      headers: { signature: signed.signature, timestamp: signed.timestamp },
      env: configuredEnv
    });

    expect(first.status).toBe("PROCESSED");
    expect(second.status).toBe("DUPLICATE");
    await expect(
      prisma.message.count({ where: { providerMessageId: "ses-r6-duplicate" } })
    ).resolves.toBe(1);
  });

  it("persists failed inbound state when sender-to-lead matching is ambiguous", async () => {
    await createLead("r6-ambiguous@example.com", "one");
    await createLead("r6-ambiguous@example.com", "two");
    const payload = inboundPayload({
      providerMessageId: "ses-r6-ambiguous",
      from: "r6-ambiguous@example.com"
    });
    const signed = sign(payload);

    const result = await ingestSesInboundEmail({
      body: payload,
      rawBody: signed.rawBody,
      headers: { signature: signed.signature, timestamp: signed.timestamp },
      env: configuredEnv
    });

    expect(result.status).toBe("FAILED");
    expect(result.inboundEmail.failureCode).toBe("AMBIGUOUS_LEAD_MATCH");
    expect(result.inboundEmail.messageId).toBeNull();
    await expect(
      prisma.message.count({ where: { providerMessageId: "ses-r6-ambiguous" } })
    ).resolves.toBe(0);
  });
});
