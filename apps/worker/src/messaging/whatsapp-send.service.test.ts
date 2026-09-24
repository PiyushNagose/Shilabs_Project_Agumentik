import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { WorkerMessagingProvider } from "../integrations/meta-whatsapp.provider.js";
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
  const stage = await prisma.pipelineStage.upsert({
    where: { key: "R24_WORKER_NEW" },
    create: { key: "R24_WORKER_NEW", label: "R24 Worker New", order: 9241, probability: 10 },
    update: {}
  });
  const company = await prisma.company.create({
    data: { name: `${companyPrefix} ${crypto.randomUUID()}` }
  });
  const contact = await prisma.contact.create({
    data: {
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
      companyId: company.id,
      contactId: contact.id,
      source: "R24_WORKER_TEST",
      stageId: stage.id,
      status: "OPEN"
    }
  });
  const sequence = await prisma.callingSequence.create({
    data: {
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
});
