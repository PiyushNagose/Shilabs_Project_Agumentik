import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../shared/prisma.js";
import {
  getMessagingHealth,
  ingestMetaWhatsAppWebhook,
  verifyMetaWebhookChallenge
} from "./messaging.service.js";

const companyPrefix = "R24 Messaging Company";
const webhookSecret = "r24-test-webhook-secret";
const verifyToken = "r24-test-verify-token";

function testEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    MESSAGING_PROVIDER: "meta_whatsapp",
    WHATSAPP_ACCESS_TOKEN: "test-access-token",
    WHATSAPP_PHONE_NUMBER_ID: "123456789",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: verifyToken,
    WHATSAPP_APP_SECRET: webhookSecret,
    WHATSAPP_DEFAULT_TEMPLATE_NAME: "r24_test_template",
    WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE: "en",
    ...overrides
  };
}

function signature(rawBody: string): string {
  return `sha256=${crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`;
}

async function cleanup(): Promise<void> {
  const leads = await prisma.lead.findMany({
    where: { company: { name: { startsWith: companyPrefix } } },
    select: { id: true }
  });
  const leadIds = leads.map((lead) => lead.id);
  await prisma.whatsAppProviderEvent.deleteMany({
    where: {
      OR: [
        { providerEventId: { contains: "r24-test" } },
        { providerMessageId: { startsWith: "r24-test" } }
      ]
    }
  });
  await prisma.outboundWhatsAppMessage.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.domainEventOutbox.deleteMany({ where: { idempotencyKey: { startsWith: "r24-test" } } });
  await prisma.callingAttempt.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.callingSequence.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.followUpAttempt.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.followUpSequence.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.message.deleteMany({ where: { conversation: { leadId: { in: leadIds } } } });
  await prisma.conversation.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.activity.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: leadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { company: { name: { startsWith: companyPrefix } } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: companyPrefix } } });
}

async function createLeadFixture() {
  const stage = await prisma.pipelineStage.upsert({
    where: { key: "R24_MSG_NEW" },
    create: {
      key: "R24_MSG_NEW",
      label: "R24 Messaging New",
      order: 9240,
      probability: 10
    },
    update: {}
  });
  const company = await prisma.company.create({
    data: { name: `${companyPrefix} ${crypto.randomUUID()}` }
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "R24",
      lastName: "Prospect",
      phone: "+919999000001",
      normalizedPhone: "+919999000001",
      whatsappId: "919999000001",
      doNotContact: false
    }
  });
  const lead = await prisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      source: "R24_TEST",
      stageId: stage.id,
      status: "OPEN"
    }
  });
  const followUp = await prisma.followUpSequence.create({
    data: {
      leadId: lead.id,
      contactId: contact.id,
      cadenceDays: [0, 1],
      idempotencyKey: `r24-test-followup:${lead.id}`
    }
  });
  const calling = await prisma.callingSequence.create({
    data: {
      leadId: lead.id,
      contactId: contact.id,
      followUpSequenceId: followUp.id,
      cadenceOffsets: [0],
      maxAttempts: 1,
      idempotencyKey: `r24-test-calling:${lead.id}`
    }
  });
  await prisma.callingAttempt.create({
    data: {
      sequenceId: calling.id,
      leadId: lead.id,
      contactId: contact.id,
      attemptIndex: 0,
      scheduledAt: new Date(),
      idempotencyKey: `r24-test-calling-attempt:${lead.id}`
    }
  });
  await prisma.domainEventOutbox.create({
    data: {
      eventType: "WHATSAPP_SEND_REQUESTED",
      aggregateType: "CallingSequence",
      aggregateId: calling.id,
      payload: { leadId: lead.id },
      correlationId: calling.id,
      idempotencyKey: `r24-test-domain-event:${lead.id}`
    }
  });
  return { lead, contact, calling, followUp };
}

describe("R24 messaging service", () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("reports truthful not-configured health", async () => {
    const health = await getMessagingHealth({ env: { MESSAGING_PROVIDER: "none" } });
    expect(health.status).toBe("NOT_CONFIGURED");
    expect(health.configured).toBe(false);
    expect(health.provider).toBe("NONE");
  });

  it("verifies Meta webhook challenge using configured token", () => {
    expect(
      verifyMetaWebhookChallenge({
        mode: "subscribe",
        token: verifyToken,
        challenge: "challenge-ok",
        env: testEnv()
      })
    ).toBe("challenge-ok");
  });

  it("persists inbound WhatsApp replies, stops incompatible automation, and is idempotent", async () => {
    const fixture = await createLeadFixture();
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "r24-entry",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                messages: [
                  {
                    id: "r24-test-inbound-message-001",
                    from: fixture.contact.whatsappId,
                    timestamp: "1790200000",
                    type: "text",
                    text: { body: "Interested, please share details." }
                  }
                ]
              }
            }
          ]
        }
      ]
    };
    const rawBody = JSON.stringify(body);

    const first = await ingestMetaWhatsAppWebhook({
      body,
      rawBody,
      signature: signature(rawBody),
      env: testEnv()
    });
    const second = await ingestMetaWhatsAppWebhook({
      body,
      rawBody,
      signature: signature(rawBody),
      env: testEnv()
    });

    expect(first.processed).toBe(1);
    expect(second.processed).toBe(1);
    await expect(
      prisma.message.count({ where: { providerMessageId: "r24-test-inbound-message-001" } })
    ).resolves.toBe(1);
    await expect(prisma.followUpSequence.findUnique({ where: { id: fixture.followUp.id } })).resolves.toMatchObject({
      status: "STOPPED",
      stopReason: "WHATSAPP_REPLY_RECEIVED"
    });
    await expect(prisma.callingSequence.findUnique({ where: { id: fixture.calling.id } })).resolves.toMatchObject({
      status: "STOPPED",
      stopReason: "WHATSAPP_REPLY_RECEIVED"
    });
  });
});
