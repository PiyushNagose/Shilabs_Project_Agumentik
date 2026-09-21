import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { sendOutboundEmail } from "./email.service.js";

const runMailpitE2E = process.env.RUN_MAILPIT_E2E === "true";
const describeMailpit = runMailpitE2E ? describe : describe.skip;
const source = "mailpit-e2e";
const actorEmail = "mailpit-e2e-admin@example.local";
const mailpitApiUrl = process.env.MAILPIT_HTTP_URL ?? "http://localhost:8025";

interface MailpitMessageSummary {
  ID?: string;
  MessageID?: string;
  To?: { Address?: string }[];
  Subject?: string;
}

interface MailpitMessagesResponse {
  messages?: MailpitMessageSummary[];
  Messages?: MailpitMessageSummary[];
}

let actor: AuthenticatedUser | undefined;

function getActor(): AuthenticatedUser {
  if (!actor) throw new Error("Mailpit E2E actor has not been seeded");
  return actor;
}

async function cleanup(): Promise<void> {
  await prisma.outboundEmail.deleteMany({ where: { lead: { source } } });
  await prisma.activity.deleteMany({ where: { lead: { source } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: actor?.id } });
  await prisma.lead.deleteMany({ where: { source } });
  await prisma.contact.deleteMany({ where: { source } });
  await prisma.company.deleteMany({ where: { name: { startsWith: "Mailpit E2E" } } });
  await prisma.authSession.deleteMany({ where: { user: { email: actorEmail } } });
  await prisma.user.deleteMany({ where: { email: actorEmail } });
}

async function clearMailpitInbox(): Promise<void> {
  await fetch(`${mailpitApiUrl}/api/v1/messages`, { method: "DELETE" }).catch(() => undefined);
}

async function waitForMailpitMessage(
  toEmail: string,
  subject: string
): Promise<MailpitMessageSummary> {
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitApiUrl}/api/v1/messages?limit=50`);
    if (response.ok) {
      const body = (await response.json()) as MailpitMessagesResponse;
      const messages = body.messages ?? body.Messages ?? [];
      const message = messages.find(
        (item) =>
          item.Subject === subject &&
          item.To?.some((recipient) => recipient.Address?.toLowerCase() === toEmail)
      );
      if (message) return message;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error("Mailpit did not receive the expected email");
}

async function seedLead(toEmail: string) {
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const user = await prisma.user.create({
    data: {
      email: actorEmail,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: "Mailpit",
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
  const company = await prisma.company.create({
    data: { name: `Mailpit E2E ${randomUUID()}` }
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "Local",
      lastName: "Recipient",
      email: toEmail,
      normalizedEmail: toEmail,
      source
    }
  });

  return prisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      ownerId: getActor().id,
      source,
      stageId: stage.id,
      requirement: "Verify Mailpit delivery"
    }
  });
}

describeMailpit("Mailpit local email E2E", () => {
  beforeAll(async () => {
    await cleanup();
    await clearMailpitInbox();
  }, 30000);

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  }, 30000);

  it("sends a real app email to Mailpit SMTP and receives it in Mailpit", async () => {
    const toEmail = `mailpit-${randomUUID()}@example.local`;
    const subject = `Mailpit E2E ${randomUUID()}`;
    const lead = await seedLead(toEmail);

    const email = await sendOutboundEmail(
      getActor(),
      {
        leadId: lead.id,
        subject,
        textBody: "This message must be accepted by Mailpit SMTP.",
        idempotencyKey: `mailpit-e2e-${lead.id}`
      },
      {
        env: {
          NODE_ENV: "development",
          EMAIL_PROVIDER: "MAILPIT",
          MAILPIT_SMTP_HOST: "localhost",
          MAILPIT_SMTP_PORT: "1025",
          MAILPIT_FROM_EMAIL: "sales@shilabs.local",
          MAILPIT_TIMEOUT_MS: "10000"
        }
      }
    );

    expect(email.status).toBe("SENT");
    expect(email.provider).toBe("MAILPIT");
    expect(email.providerMessageId).toBeTruthy();
    await expect(waitForMailpitMessage(toEmail, subject)).resolves.toBeTruthy();
  }, 30000);
});
