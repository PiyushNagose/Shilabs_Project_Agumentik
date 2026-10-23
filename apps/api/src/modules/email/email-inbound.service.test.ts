import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import { ingestSesInboundEmail } from "./email.service.js";
import type { AIProvider } from "../ai/ai.provider.js";
import { processInboundReply } from "../reply-processing/reply-processing.service.js";
import { recalculateQualification } from "../qualification/qualification.service.js";

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
  await prisma.leadQualificationEvidence.deleteMany({
    where: { qualification: { lead: { source: "r6-inbound-test" } } }
  });
  await prisma.leadQualification.deleteMany({ where: { lead: { source: "r6-inbound-test" } } });
  await prisma.callingSequence.deleteMany({ where: { lead: { source: "r6-inbound-test" } } });
  await prisma.followUpSequence.deleteMany({ where: { lead: { source: "r6-inbound-test" } } });
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
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({
    data: {
      workspaceId: workspace.id,
      name: `R6 Company ${suffix}`
    }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
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
      workspaceId: workspace.id,
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
    await expect(
      prisma.emailProviderEvent.count({ where: { type: "INBOUND_RECEIVED" } })
    ).resolves.toBe(1);
    await expect(
      prisma.lead.findUnique({
        where: { id: lead.id },
        select: { automationOwnershipState: true, automationOwnershipReason: true }
      })
    ).resolves.toMatchObject({
      automationOwnershipState: "HUMAN_REQUIRED",
      automationOwnershipReason: "MEANINGFUL_CLIENT_REPLY:EMAIL"
    });
  });

  it.each([
    { name: "OOO header", headers: [{ name: "Auto-Submitted", value: "auto-replied" }] },
    {
      name: "raw MIME receipt",
      content: "Auto-Submitted: auto-generated\r\nSubject: Receipt\r\n\r\nReceived",
      expectedTextBody: "Received"
    },
    {
      name: "bounce",
      headers: [
        {
          name: "Content-Type",
          value: "multipart/report; report-type=delivery-status; boundary=abc"
        }
      ]
    },
    {
      name: "newsletter",
      headers: [
        { name: "List-Id", value: "<news.example.com>" },
        { name: "List-Unsubscribe", value: "<mailto:leave@example.com>" },
        { name: "Precedence", value: "bulk" }
      ]
    },
    { name: "OOO template", subject: "Out of office", textBody: "I am out of the office." }
  ])(
    "persists $name without handing off or stopping automation; a later human reply stops immediately",
    async (automatic) => {
      const lead = await createLead(`r6-auto-${crypto.randomUUID()}@example.com`);
      const sequence = await prisma.followUpSequence.create({
        data: {
          workspaceId: lead.workspaceId,
          leadId: lead.id,
          contactId: lead.contactId,
          cadenceDays: [1],
          idempotencyKey: `r6-${crypto.randomUUID()}`
        }
      });
      const calling = await prisma.callingSequence.create({
        data: {
          workspaceId: lead.workspaceId,
          leadId: lead.id,
          contactId: lead.contactId,
          cadenceOffsets: [1],
          maxAttempts: 1,
          idempotencyKey: `r6-${crypto.randomUUID()}`
        }
      });
      if (!lead.contact.email) throw new Error("Fixture email is missing");
      const base = inboundPayload({
        providerMessageId: `ses-r6-${crypto.randomUUID()}`,
        from: lead.contact.email,
        leadId: lead.id
      }) as {
        mail: {
          source: string;
          headers: { name: string; value: string }[];
          commonHeaders: { subject: string; from: string[]; to: string[]; cc?: string[] };
        };
        textBody: string;
      };
      base.mail.headers.push(...(automatic.headers ?? []));
      if (automatic.subject) base.mail.commonHeaders.subject = automatic.subject;
      if (automatic.textBody) base.textBody = automatic.textBody;
      if (automatic.name === "raw MIME receipt") {
        base.mail.source = "bounce@example.com";
        base.mail.commonHeaders.cc = ["archive@example.com"];
      }
      const payload = { ...base, ...(automatic.content ? { content: automatic.content } : {}) };
      const signed = sign(payload);
      const result = await ingestSesInboundEmail({
        body: payload,
        rawBody: signed.rawBody,
        headers: signed,
        env: configuredEnv
      });
      expect(result.status).toBe("PROCESSED");
      expect(result.inboundEmail.replyProcessingStatus).toBe("SKIPPED");
      expect(result.inboundEmail.failureCode).toBeNull();
      const saved = await prisma.inboundEmail.findUniqueOrThrow({
        where: { id: result.inboundEmail.id },
        include: { message: true }
      });
      expect(saved.rawProviderPayload).toEqual(payload);
      expect(saved.message).toMatchObject({
        direction: "INBOUND",
        body: automatic.expectedTextBody ?? base.textBody,
        metadata: {
          inboundClassification: { version: 1, kind: "NONMEANINGFUL" }
        }
      });
      if (automatic.name === "raw MIME receipt") {
        expect(saved).toMatchObject({
          fromEmail: lead.contact.email,
          toEmails: base.mail.commonHeaders.to,
          ccEmails: base.mail.commonHeaders.cc,
          subject: "Receipt",
          textBody: "Received"
        });
      }
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
        automationOwnershipState: lead.automationOwnershipState
      });
      expect(
        await prisma.followUpSequence.findUniqueOrThrow({ where: { id: sequence.id } })
      ).toMatchObject({ status: "ACTIVE" });
      expect(
        await prisma.callingSequence.findUniqueOrThrow({ where: { id: calling.id } })
      ).toMatchObject({ status: "ACTIVE" });
      if (!saved.messageId) throw new Error("Persisted inbound message is missing");
      expect(
        await prisma.auditEvent.count({
          where: { entityId: saved.messageId, action: "REPLY_PROCESSING_TRIGGERED" }
        })
      ).toBe(0);
      expect(
        await prisma.auditEvent.count({
          where: { entityId: saved.messageId, action: "REPLY_PROCESSING_SKIPPED" }
        })
      ).toBe(1);
      const understandReply = vi.fn();
      const automaticQualification = vi.fn();
      const provider = {
        understandReply,
        extractQualification: automaticQualification
      } as unknown as AIProvider;
      await expect(processInboundReply(saved.id, { provider })).rejects.toMatchObject({
        code: "CONFLICT"
      });
      await recalculateQualification(lead.id, provider);
      expect(understandReply).not.toHaveBeenCalled();
      expect(automaticQualification).not.toHaveBeenCalled();
      expect(await prisma.replyProcessingRun.count({ where: { inboundEmailId: saved.id } })).toBe(
        0
      );
      const duplicate = await ingestSesInboundEmail({
        body: payload,
        rawBody: signed.rawBody,
        headers: signed,
        env: configuredEnv
      });
      expect(duplicate.status).toBe("DUPLICATE");
      expect(duplicate.inboundEmail.replyProcessingStatus).toBe("SKIPPED");

      const human = inboundPayload({
        providerMessageId: `ses-r6-${crypto.randomUUID()}`,
        from: lead.contact.email,
        leadId: lead.id,
        subject: "Re: Out of office"
      }) as typeof base;
      human.textBody = "Please stop emailing me.\n> I am out of the office.";
      const humanSigned = sign(human);
      const received = await ingestSesInboundEmail({
        body: human,
        rawBody: humanSigned.rawBody,
        headers: humanSigned,
        env: configuredEnv
      });
      expect(received.inboundEmail.replyProcessingStatus).toBe("PENDING");
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
        automationOwnershipState: "HUMAN_REQUIRED"
      });
      expect(
        await prisma.followUpSequence.findUniqueOrThrow({ where: { id: sequence.id } })
      ).toMatchObject({ status: "STOPPED" });
      expect(
        await prisma.callingSequence.findUniqueOrThrow({ where: { id: calling.id } })
      ).toMatchObject({ status: "STOPPED" });
      const extractQualification = vi.fn().mockResolvedValue({
        need: null,
        requirement: null,
        budget: null,
        budgetBand: null,
        authority: null,
        timeline: null,
        businessFit: null,
        decisionMakerIdentified: null,
        urgency: null,
        evidence: []
      });
      provider.extractQualification = extractQualification;
      await recalculateQualification(lead.id, provider);
      expect(extractQualification).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { id: received.inboundEmail.messageId, senderType: "PROSPECT", body: human.textBody }
          ]
        })
      );
    }
  );

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
