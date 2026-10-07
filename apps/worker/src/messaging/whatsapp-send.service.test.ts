import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getMessagingConfig } from "@shilabs/shared-config";
import type { WorkerMessagingProvider } from "../integrations/meta-whatsapp.provider.js";
import { WorkerTwilioWhatsAppProvider } from "../integrations/meta-whatsapp.provider.js";
import type { TimelineSyncer } from "../followups/zoho-timeline.syncer.js";
import { executeWhatsAppSend } from "./whatsapp-send.service.js";

const prisma = new PrismaClient();
const companyPrefix = "R24 Worker WhatsApp Company";

class FakeMessagingProvider implements WorkerMessagingProvider {
  public readonly sendTemplateMessageMock = vi.fn<WorkerMessagingProvider["sendTemplateMessage"]>();

  public sendTemplateMessage(input: Parameters<WorkerMessagingProvider["sendTemplateMessage"]>[0]) {
    return this.sendTemplateMessageMock(input);
  }
}

class FakeTimelineSyncer implements TimelineSyncer {
  public readonly syncActivityMock = vi.fn<TimelineSyncer["syncActivity"]>();

  public syncActivity(input: Parameters<TimelineSyncer["syncActivity"]>[0]) {
    return this.syncActivityMock(input);
  }
}

function testEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    MESSAGING_PROVIDER: "meta_whatsapp",
    WHATSAPP_ACCESS_TOKEN: "test-access-token",
    WHATSAPP_PHONE_NUMBER_ID: "123456789",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "test-token",
    WHATSAPP_APP_SECRET: "test-secret",
    WHATSAPP_DEFAULT_TEMPLATE_NAME: "r24_test_template",
    WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE: "en",
    WHATSAPP_E2E_ALLOWED_TO_NUMBERS: "+919999000002",
    ...overrides
  };
}

async function cleanup(): Promise<void> {
  const leads = await prisma.lead.findMany({
    where: { company: { name: { startsWith: companyPrefix } } },
    select: { id: true }
  });
  const leadIds = leads.map((lead) => lead.id);
  await prisma.whatsAppProviderEvent.deleteMany({
    where: { outboundMessage: { leadId: { in: leadIds } } }
  });
  await prisma.externalRecordMapping.deleteMany({
    where: { provider: "META_WHATSAPP", entityType: "WHATSAPP_MESSAGE" }
  });
  await prisma.outboundWhatsAppMessage.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.domainEventOutbox.deleteMany({ where: { idempotencyKey: { startsWith: "r24-worker" } } });
  await prisma.callingAttempt.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.callingSequence.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.activity.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityType: { in: ["OutboundWhatsAppMessage"] } } });
  await prisma.conversation.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { company: { name: { startsWith: companyPrefix } } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: companyPrefix } } });
}

async function createFixture() {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const stage = await prisma.pipelineStage.upsert({
    where: { key: "R24_WORKER_NEW" },
    create: { key: "R24_WORKER_NEW", label: "R24 Worker New", order: 9241, probability: 10 },
    update: {}
  });
  const company = await prisma.company.create({
    data: { workspaceId: workspace.id, name: `${companyPrefix} ${crypto.randomUUID()}` }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "R24",
      lastName: "Worker",
      phone: "+919999000002",
      normalizedPhone: "+919999000002",
      whatsappId: "+919999000002",
      doNotContact: false
    }
  });
  const lead = await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      source: "R24_WORKER_TEST",
      stageId: stage.id,
      status: "OPEN"
    }
  });
  const sequence = await prisma.callingSequence.create({
    data: {
      workspaceId: workspace.id,
      leadId: lead.id,
      contactId: contact.id,
      cadenceOffsets: [0],
      maxAttempts: 1,
      idempotencyKey: `r24-worker-calling:${lead.id}`
    }
  });
  const attempt = await prisma.callingAttempt.create({
    data: {
      sequenceId: sequence.id,
      leadId: lead.id,
      contactId: contact.id,
      attemptIndex: 0,
      scheduledAt: new Date(),
      idempotencyKey: `r24-worker-attempt:${lead.id}`
    }
  });
  const event = await prisma.domainEventOutbox.create({
    data: {
      workspaceId: workspace.id,
      eventType: "WHATSAPP_SEND_REQUESTED",
      aggregateType: "CallingAttempt",
      aggregateId: attempt.id,
      payload: { leadId: lead.id, contactId: contact.id, callingSequenceId: sequence.id, callingAttemptId: attempt.id },
      correlationId: sequence.id,
      idempotencyKey: `r24-worker-event:${attempt.id}`
    }
  });
  return { lead, attempt, event };
}

describe("R24 WhatsApp send worker", () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("sends once, persists mapping/evidence, and retries Zoho without resending", async () => {
    const fixture = await createFixture();
    const provider = new FakeMessagingProvider();
    provider.sendTemplateMessageMock.mockResolvedValue({
      status: "ACCEPTED",
      providerMessageId: "wamid.r24-worker-001",
      providerStatus: "accepted",
      lastError: null
    });
    const timeline = new FakeTimelineSyncer();
    timeline.syncActivityMock
      .mockResolvedValueOnce({ status: "FAILED", externalRecordId: null, lastError: "Zoho unavailable" })
      .mockResolvedValueOnce({ status: "SYNCED", externalRecordId: "timeline-1", lastError: null });

    await expect(
      executeWhatsAppSend({ event: fixture.event, env: testEnv(), provider, timelineSyncer: timeline })
    ).rejects.toThrow("Zoho unavailable");
    await executeWhatsAppSend({ event: fixture.event, env: testEnv(), provider, timelineSyncer: timeline });

    expect(provider.sendTemplateMessageMock).toHaveBeenCalledTimes(1);
    await expect(
      prisma.outboundWhatsAppMessage.count({ where: { leadId: fixture.lead.id, status: "SENT" } })
    ).resolves.toBe(1);
    await expect(
      prisma.externalRecordMapping.count({
        where: { provider: "META_WHATSAPP", entityType: "WHATSAPP_MESSAGE" }
      })
    ).resolves.toBe(1);
  });

  it("persists truthful not-configured failure without provider success", async () => {
    const fixture = await createFixture();
    const provider = new FakeMessagingProvider();

    await expect(
      executeWhatsAppSend({
        event: fixture.event,
        env: testEnv({ WHATSAPP_ACCESS_TOKEN: "" }),
        provider
      })
    ).rejects.toThrow("Missing configuration");

    expect(provider.sendTemplateMessageMock).not.toHaveBeenCalled();
    await expect(
      prisma.outboundWhatsAppMessage.count({
        where: { leadId: fixture.lead.id, status: "NOT_CONFIGURED" }
      })
    ).resolves.toBe(1);
  });

  it("continues WhatsApp independently when the call side of the handoff needs attention", async () => {
    const fixture = await createFixture();
    await prisma.callingSequence.update({
      where: { id: fixture.attempt.sequenceId },
      data: { status: "ATTENTION_REQUIRED", stopReason: "CONTACT_PHONE_MISSING" }
    });
    const provider = new FakeMessagingProvider();
    provider.sendTemplateMessageMock.mockResolvedValue({
      status: "ACCEPTED",
      providerMessageId: "wamid.r24-independent-whatsapp",
      providerStatus: "accepted",
      lastError: null
    });
    const timeline = new FakeTimelineSyncer();
    timeline.syncActivityMock.mockResolvedValue({
      status: "SYNCED",
      externalRecordId: "timeline-independent-whatsapp",
      lastError: null
    });

    await executeWhatsAppSend({ event: fixture.event, env: testEnv(), provider, timelineSyncer: timeline });

    expect(provider.sendTemplateMessageMock).toHaveBeenCalledTimes(1);
    await expect(
      prisma.outboundWhatsAppMessage.findFirst({
        where: { leadId: fixture.lead.id },
        select: { status: true }
      })
    ).resolves.toMatchObject({ status: "SENT" });
  });

  it("sends Twilio WhatsApp through the real Messages API adapter request shape", async () => {
    const requests: { url: string; body: URLSearchParams; authorization: string | null }[] = [];
    const provider = new WorkerTwilioWhatsAppProvider(
      getMessagingConfig(
        testEnv({
          MESSAGING_PROVIDER: "twilio_whatsapp",
          TWILIO_WHATSAPP_ACCOUNT_SID: "ACtwilio",
          TWILIO_WHATSAPP_AUTH_TOKEN: "twilio-auth-token",
          TWILIO_WHATSAPP_SANDBOX_FROM: "whatsapp:+14155238886",
          TWILIO_WHATSAPP_DEFAULT_BODY: "R24 Twilio sandbox message"
        })
      ),
      (url, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: url instanceof Request ? url.url : String(url),
          body: init?.body as URLSearchParams,
          authorization: headers.get("authorization")
        });
        return Promise.resolve(Response.json({ sid: "SM-r24-worker-twilio-001", status: "queued" }));
      }
    );

    const result = await provider.sendTemplateMessage({
      to: "+919999000002",
      templateName: "unused-for-twilio",
      templateLanguage: "en",
      idempotencyKey: "r24-worker-twilio-idempotency"
    });

    expect(result).toMatchObject({
      status: "ACCEPTED",
      providerMessageId: "SM-r24-worker-twilio-001",
      providerStatus: "queued"
    });
    expect(requests[0]?.url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtwilio/Messages.json");
    expect(requests[0]?.body.get("From")).toBe("whatsapp:+14155238886");
    expect(requests[0]?.body.get("To")).toBe("whatsapp:+919999000002");
    expect(requests[0]?.body.get("Body")).toBe("R24 Twilio sandbox message");
    expect(requests[0]?.authorization).toBe(`Basic ${Buffer.from("ACtwilio:twilio-auth-token").toString("base64")}`);
  });

  it("preserves the provider reason when Twilio rejects a WhatsApp request", async () => {
    const provider = new WorkerTwilioWhatsAppProvider(
      getMessagingConfig(
        testEnv({
          MESSAGING_PROVIDER: "twilio_whatsapp",
          TWILIO_WHATSAPP_ACCOUNT_SID: "ACtwilio",
          TWILIO_WHATSAPP_AUTH_TOKEN: "twilio-auth-token",
          TWILIO_WHATSAPP_SANDBOX_FROM: "whatsapp:+14155238886"
        })
      ),
      () => Promise.resolve(Response.json({ code: 63016, message: "The user has not joined the sandbox" }, { status: 400 }))
    );

    await expect(
      provider.sendTemplateMessage({
        to: "+919999000002",
        templateName: "unused-for-twilio",
        templateLanguage: "en",
        idempotencyKey: "r24-worker-twilio-rejected"
      })
    ).resolves.toMatchObject({
      status: "FAILED",
      lastError: "WhatsApp provider request failed with status 400: code 63016: The user has not joined the sandbox"
    });
  });
});
