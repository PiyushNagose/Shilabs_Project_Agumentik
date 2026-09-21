import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LeadStatus, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type {
  EmailHealthResult,
  EmailProvider,
  EmailSendInput,
  EmailSendResult
} from "./email.provider.js";
import {
  createEmailSuppression,
  getAwsSesHealth,
  ingestSesFeedbackEvent,
  runEmailDeliverabilityScan,
  sendOutboundEmail,
  validateOutboundEmailPreSend
} from "./email.service.js";

const actorEmail = "r5-email-admin@example.local";
const configuredEnv = {
  AWS_SES_REGION: "us-east-1",
  AWS_SES_FROM_EMAIL: "sales@example.com",
  AWS_SES_ACCESS_KEY_ID: "test-access-key",
  AWS_SES_SECRET_ACCESS_KEY: "test-secret-key",
  AWS_SES_WEBHOOK_SECRET: "test-webhook-secret",
  AWS_SES_USE_DEFAULT_CREDENTIAL_CHAIN: "false"
};

class TestEmailProvider implements EmailProvider {
  public readonly sendEmailMock = vi.fn<EmailProvider["sendEmail"]>();
  public readonly verifyConnectionMock = vi.fn<EmailProvider["verifyConnection"]>();

  public constructor() {
    this.sendEmailMock.mockResolvedValue({
      provider: "AWS_SES",
      providerMessageId: "ses-message-1"
    });
    this.verifyConnectionMock.mockResolvedValue({
      provider: "AWS_SES",
      sendingEnabled: true
    });
  }

  public verifyConnection(): Promise<EmailHealthResult> {
    return this.verifyConnectionMock();
  }

  public sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
    return this.sendEmailMock(input);
  }
}

function sign(body: unknown, secret = configuredEnv.AWS_SES_WEBHOOK_SECRET): {
  rawBody: string;
  timestamp: string;
  signature: string;
} {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Date.now());
  const signature = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
  return { rawBody, timestamp, signature };
}

async function cleanup(): Promise<void> {
  await prisma.emailProviderEvent.deleteMany({
    where: {
      OR: [
        { providerEventId: { startsWith: "r5-" } },
        { providerMessageId: { startsWith: "ses-r5-" } },
        { providerMessageId: "ses-message-1" }
      ]
    }
  });
  await prisma.emailSuppression.deleteMany({
    where: {
      OR: [
        { normalizedEmail: { contains: "r5-" } },
        { normalizedEmail: "lead@example.com" },
        { normalizedEmail: "suppressed@example.com" }
      ]
    }
  });
  await prisma.emailDeliverabilityScan.deleteMany({
    where: { requestedByUserId: actor?.id }
  });
  await prisma.outboundEmail.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: "r5-" } },
        { toEmail: { contains: "r5-" } },
        { providerMessageId: { startsWith: "ses-r5-" } },
        { providerMessageId: "ses-message-1" }
      ]
    }
  });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [{ entityType: "OutboundEmail" }, { actorId: actor?.id }]
    }
  });
  await prisma.activity.deleteMany({
    where: {
      OR: [{ description: { contains: "r5-" } }, { description: { contains: "Email sent" } }]
    }
  });
  await prisma.lead.deleteMany({ where: { source: { startsWith: "r5-" } } });
  await prisma.contact.deleteMany({ where: { source: { startsWith: "r5-" } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: "R5 " } } });
  await prisma.authSession.deleteMany({ where: { user: { email: actorEmail } } });
  await prisma.user.deleteMany({ where: { email: actorEmail } });
}

let actor: AuthenticatedUser | undefined;

function getActor(): AuthenticatedUser {
  if (!actor) {
    throw new Error("Test actor has not been created");
  }

  return actor;
}

async function createLead(input?: {
  email?: string | null;
  doNotContact?: boolean;
  status?: LeadStatus;
}) {
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({
    data: {
      name: `R5 Company ${crypto.randomUUID()}`
    }
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "R5",
      lastName: "Lead",
      email: input?.email ?? "lead@example.com",
      normalizedEmail: input?.email?.toLowerCase() ?? "lead@example.com",
      source: "r5-email-test",
      doNotContact: input?.doNotContact ?? false
    }
  });
  return prisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      ownerId: getActor().id,
      source: "r5-email-test",
      status: input?.status ?? "OPEN",
      stageId: stage.id
    },
    include: { contact: true }
  });
}

describe("AWS SES email service", () => {
  beforeAll(async () => {
    await cleanup();
    const user = await prisma.user.create({
      data: {
        email: actorEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "Email",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });
    actor = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  });

  beforeEach(async () => {
    await prisma.emailProviderEvent.deleteMany();
    await prisma.emailSuppression.deleteMany();
    await prisma.emailDeliverabilityScan.deleteMany();
    await prisma.outboundEmail.deleteMany();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("reports NOT_CONFIGURED without probing SES or returning fake health", async () => {
    const provider = new TestEmailProvider();

    const health = await getAwsSesHealth({ env: {}, provider });

    expect(health.provider).toBe("AWS_SES");
    expect(health.status).toBe("NOT_CONFIGURED");
    expect(health.configured).toBe(false);
    expect(provider.verifyConnectionMock).not.toHaveBeenCalled();
  });

  it("persists failed outbound request when SES is not configured", async () => {
    const lead = await createLead();

    const email = await sendOutboundEmail(
      getActor(),
      {
        leadId: lead.id,
        subject: "r5 not configured",
        textBody: "Hello",
        idempotencyKey: "r5-not-configured"
      },
      { env: {} }
    );

    expect(email.status).toBe("FAILED");
    expect(email.failureCode).toBe("AWS_SES_NOT_CONFIGURED");
    await expect(prisma.outboundEmail.count()).resolves.toBe(1);
  });

  it("blocks suppressed addresses before calling SES", async () => {
    const provider = new TestEmailProvider();
    const lead = await createLead({ email: "suppressed@example.com" });
    await prisma.emailSuppression.create({
      data: {
        email: "suppressed@example.com",
        normalizedEmail: "suppressed@example.com",
        reason: "MANUAL",
        source: "TEST"
      }
    });

    const email = await sendOutboundEmail(
      getActor(),
      {
        leadId: lead.id,
        subject: "r5 suppressed",
        textBody: "Hello",
        idempotencyKey: "r5-suppressed"
      },
      { env: configuredEnv, provider }
    );

    expect(email.status).toBe("BLOCKED");
    expect(email.failureCode).toBe("EMAIL_SUPPRESSED");
    expect(provider.sendEmailMock).not.toHaveBeenCalled();
  });

  it("returns pre-send validation without calling SES", async () => {
    const lead = await createLead({ email: "r7-validate@example.com" });

    const validation = await validateOutboundEmailPreSend(getActor(), { leadId: lead.id });

    expect(validation.allowed).toBe(true);
    expect(validation.normalizedEmail).toBe("r7-validate@example.com");
    expect(validation.code).toBeNull();
  });

  it("returns suppression details during pre-send validation", async () => {
    const lead = await createLead({ email: "r7-suppressed@example.com" });
    await prisma.emailSuppression.create({
      data: {
        email: "r7-suppressed@example.com",
        normalizedEmail: "r7-suppressed@example.com",
        reason: "MANUAL",
        source: "TEST"
      }
    });

    const validation = await validateOutboundEmailPreSend(getActor(), { leadId: lead.id });

    expect(validation.allowed).toBe(false);
    expect(validation.code).toBe("EMAIL_SUPPRESSED");
    expect(validation.suppression?.reason).toBe("MANUAL");
  });

  it("upserts manual suppressions idempotently and audits the change", async () => {
    const first = await createEmailSuppression(getActor(), {
      email: "R7-Manual@example.com",
      reason: "MANUAL",
      source: "OPERATOR"
    });
    const second = await createEmailSuppression(getActor(), {
      email: "r7-manual@example.com",
      reason: "UNSUBSCRIBE",
      source: "OPERATOR"
    });

    expect(second.id).toBe(first.id);
    expect(second.normalizedEmail).toBe("r7-manual@example.com");
    expect(second.reason).toBe("UNSUBSCRIBE");
    await expect(
      prisma.emailSuppression.count({ where: { normalizedEmail: "r7-manual@example.com" } })
    ).resolves.toBe(1);
    await expect(
      prisma.auditEvent.count({
        where: { entityType: "EmailSuppression", action: "EMAIL_SUPPRESSION_UPSERTED" }
      })
    ).resolves.toBeGreaterThanOrEqual(2);
  });

  it("records deliverability scans and suppresses invalid contact emails", async () => {
    await createLead({ email: "r7-eligible@example.com" });
    await createLead({ email: "r7-dnc@example.com", doNotContact: true });
    await createLead({ email: "r7-won@example.com", status: LeadStatus.WON });
    await createLead({ email: "not-an-email" });

    const scan = await runEmailDeliverabilityScan(getActor());

    expect(scan.status).toBe("COMPLETED");
    expect(scan.totalContacts).toBeGreaterThanOrEqual(4);
    expect(scan.eligibleContacts).toBeGreaterThanOrEqual(1);
    expect(scan.invalidContacts).toBeGreaterThanOrEqual(1);
    expect(scan.doNotContactContacts).toBeGreaterThanOrEqual(1);
    expect(scan.terminalLeadContacts).toBeGreaterThanOrEqual(1);
    await expect(
      prisma.emailSuppression.findUnique({ where: { normalizedEmail: "not-an-email" } })
    ).resolves.toMatchObject({ reason: "INVALID", source: "DELIVERABILITY_SCAN" });
  });

  it("sends idempotently only after SES returns a provider message id", async () => {
    const provider = new TestEmailProvider();
    const lead = await createLead({ email: "r5-success@example.com" });
    provider.sendEmailMock.mockResolvedValue({
      provider: "AWS_SES",
      providerMessageId: "ses-r5-success"
    });

    const input = {
      leadId: lead.id,
      subject: "r5 success",
      textBody: "Hello",
      idempotencyKey: "r5-success"
    };
    const first = await sendOutboundEmail(getActor(), input, { env: configuredEnv, provider });
    const second = await sendOutboundEmail(getActor(), input, { env: configuredEnv, provider });

    expect(first.status).toBe("SENT");
    expect(first.providerMessageId).toBe("ses-r5-success");
    expect(second.id).toBe(first.id);
    expect(provider.sendEmailMock).toHaveBeenCalledTimes(1);
    await expect(prisma.activity.count({ where: { leadId: lead.id } })).resolves.toBe(1);
  });

  it("stores failed provider sends without marking sent", async () => {
    const provider = new TestEmailProvider();
    const lead = await createLead({ email: "r5-provider-fail@example.com" });
    provider.sendEmailMock.mockRejectedValue(new Error("SES rejected identity"));

    const email = await sendOutboundEmail(
      getActor(),
      {
        leadId: lead.id,
        subject: "r5 fail",
        textBody: "Hello",
        idempotencyKey: "r5-provider-fail"
      },
      { env: configuredEnv, provider }
    );

    expect(email.status).toBe("FAILED");
    expect(email.providerMessageId).toBeNull();
    expect(email.failureCode).toBe("AWS_SES_SEND_FAILED");
  });

  it("ingests bounce feedback idempotently and suppresses recipients", async () => {
    const lead = await createLead({ email: "r5-bounce@example.com" });
    const sent = await prisma.outboundEmail.create({
      data: {
        leadId: lead.id,
        contactId: lead.contactId,
        actorUserId: getActor().id,
        toEmail: "r5-bounce@example.com",
        normalizedToEmail: "r5-bounce@example.com",
        fromEmail: configuredEnv.AWS_SES_FROM_EMAIL,
        subject: "r5 bounce",
        textBody: "Hello",
        provider: "AWS_SES",
        providerMessageId: "ses-r5-bounce",
        idempotencyKey: "r5-bounce",
        status: "SENT",
        sentAt: new Date()
      }
    });
    const payload = {
      notificationType: "Bounce",
      mail: { messageId: "ses-r5-bounce", destination: ["r5-bounce@example.com"] },
      bounce: {
        bounceType: "Permanent",
        bouncedRecipients: [{ emailAddress: "r5-bounce@example.com" }]
      }
    };
    const signed = sign(payload);

    const first = await ingestSesFeedbackEvent({
      body: payload,
      rawBody: signed.rawBody,
      headers: { signature: signed.signature, timestamp: signed.timestamp },
      env: configuredEnv
    });
    const second = await ingestSesFeedbackEvent({
      body: payload,
      rawBody: signed.rawBody,
      headers: { signature: signed.signature, timestamp: signed.timestamp },
      env: configuredEnv
    });

    expect(first.status).toBe("PROCESSED");
    expect(first.outboundEmailId).toBe(sent.id);
    expect(second.status).toBe("DUPLICATE");
    await expect(
      prisma.outboundEmail.findUniqueOrThrow({ where: { id: sent.id } })
    ).resolves.toMatchObject({ status: "BOUNCED" });
    await expect(
      prisma.emailSuppression.findUnique({
        where: { normalizedEmail: "r5-bounce@example.com" }
      })
    ).resolves.toMatchObject({ reason: "BOUNCE" });
  });
});
