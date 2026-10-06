import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../shared/prisma.js";
import type {
  AIProvider,
  QualificationResult,
  ReplyUnderstandingResult
} from "../ai/ai.provider.js";
import {
  getMessagingHealth,
  ingestMetaWhatsAppWebhook,
  ingestTwilioWhatsAppWebhook,
  verifyMetaWebhookChallenge
} from "./messaging.service.js";

const companyPrefix = "R24 Messaging Company";
const webhookSecret = "r24-test-webhook-secret";
const verifyToken = "r24-test-verify-token";

class MessagingReplyTestProvider implements AIProvider {
  public constructor(private readonly output: ReplyUnderstandingResult) {}
  public generateSalesReply: AIProvider["generateSalesReply"] = () =>
    Promise.resolve({ body: "test", requiresHumanReview: true, reason: null });
  public extractQualification: AIProvider["extractQualification"] = () =>
    Promise.resolve({
      need: "WhatsApp follow-up",
      requirement: "Asked for details",
      budget: null,
      budgetBand: null,
      authority: null,
      timeline: null,
      businessFit: null,
      decisionMakerIdentified: null,
      urgency: null,
      evidence: []
    } satisfies QualificationResult);
  public summarizeLead: AIProvider["summarizeLead"] = () =>
    Promise.resolve({
      summary: "test",
      buyingSignals: [],
      objections: [],
      risks: [],
      suggestedNextAction: null
    });
  public generateFollowUp: AIProvider["generateFollowUp"] = () =>
    Promise.resolve({ body: "test", requiresHumanReview: true, reason: null });
  public generateProposalDraft: AIProvider["generateProposalDraft"] = () =>
    Promise.resolve({
      title: "Test proposal",
      serviceType: "AI Sales",
      content: "Proposal content",
      usedKnowledgeIds: [],
      evidence: [],
      requiresHumanReview: true,
      missingInformation: []
    });
  public understandReply: AIProvider["understandReply"] = () => Promise.resolve(this.output);
  public generateBriefing: AIProvider["generateBriefing"] = () =>
    Promise.resolve({
      summary: "Briefing",
      requirements: null,
      budget: null,
      timeline: null,
      decisionContext: null,
      recentCommunication: "No recent communication",
      qualification: null,
      proposalDealContext: null,
      meetingContext: null,
      recommendedNextAction: null,
      usedKnowledgeIds: [],
      evidence: [],
      requiresHumanReview: true,
      unknowns: []
    });
  public createEmbedding: AIProvider["createEmbedding"] = () => Promise.resolve([0.1]);
}

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

function twilioEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return testEnv({
    MESSAGING_PROVIDER: "twilio_whatsapp",
    MESSAGING_WEBHOOK_BASE_URL: "https://voice-e2e.example.test",
    TWILIO_WHATSAPP_ACCOUNT_SID: "ACtwilio",
    TWILIO_WHATSAPP_AUTH_TOKEN: "twilio-auth-token",
    TWILIO_WHATSAPP_SANDBOX_FROM: "whatsapp:+14155238886",
    ...overrides
  });
}

function twilioSignature(
  url: string,
  params: Record<string, string>,
  authToken = "twilio-auth-token"
): string {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key] ?? ""}`)
    .join("");
  return crypto.createHmac("sha1", authToken).update(`${url}${sorted}`).digest("base64");
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
  await prisma.domainEventOutbox.deleteMany({
    where: { idempotencyKey: { startsWith: "r24-test" } }
  });
  await prisma.domainEventOutbox.deleteMany({
    where: { idempotencyKey: { startsWith: "domain-event:reply-processing:" } }
  });
  await prisma.replyProcessingRun.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.inboundEmail.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.leadQualificationEvidence.deleteMany({
    where: { qualification: { leadId: { in: leadIds } } }
  });
  await prisma.leadQualification.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.leadScoreRun.deleteMany({ where: { leadId: { in: leadIds } } });
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
    const provider = new MessagingReplyTestProvider({
      intent: "INTERESTED",
      confidence: 0.9,
      summary: "Prospect asked for details.",
      draftResponse: null,
      requiresHumanReview: true,
      recommendedAction: "DRAFT_RESPONSE",
      evidence: [{ messageId: "", quote: "Interested" }],
      usedKnowledgeIds: []
    });
    provider.understandReply = (input) =>
      Promise.resolve({
        intent: "INTERESTED",
        confidence: 0.9,
        summary: "Prospect asked for details.",
        draftResponse: null,
        requiresHumanReview: true,
        recommendedAction: "DRAFT_RESPONSE",
        evidence: [{ messageId: input.messages.at(-1)?.id ?? "", quote: "Interested" }],
        usedKnowledgeIds: []
      });

    const first = await ingestMetaWhatsAppWebhook({
      body,
      rawBody,
      signature: signature(rawBody),
      env: testEnv(),
      replyProcessingOptions: { provider }
    });
    const second = await ingestMetaWhatsAppWebhook({
      body,
      rawBody,
      signature: signature(rawBody),
      env: testEnv(),
      replyProcessingOptions: { provider }
    });

    expect(first.processed).toBe(1);
    expect(second.processed).toBe(1);
    await expect(
      prisma.message.count({ where: { providerMessageId: "r24-test-inbound-message-001" } })
    ).resolves.toBe(1);
    await expect(
      prisma.followUpSequence.findUnique({ where: { id: fixture.followUp.id } })
    ).resolves.toMatchObject({
      status: "STOPPED",
      stopReason: "WHATSAPP_REPLY_RECEIVED"
    });
    await expect(
      prisma.callingSequence.findUnique({ where: { id: fixture.calling.id } })
    ).resolves.toMatchObject({
      status: "STOPPED",
      stopReason: "WHATSAPP_REPLY_RECEIVED"
    });
  }, 90000);

  it("accepts signed Twilio WhatsApp Sandbox inbound form payloads through the same R24 pipeline", async () => {
    const fixture = await createLeadFixture();
    const body = {
      MessageSid: "SM-r24-test-twilio-inbound-001",
      SmsMessageSid: "SM-r24-test-twilio-inbound-001",
      From: `whatsapp:+${fixture.contact.whatsappId ?? ""}`,
      To: "whatsapp:+14155238886",
      Body: "Please send details on WhatsApp."
    };
    const url = "https://voice-e2e.example.test/api/messaging/twilio/webhook";
    const provider = new MessagingReplyTestProvider({
      intent: "INTERESTED",
      confidence: 0.92,
      summary: "Prospect asked for more details over WhatsApp.",
      draftResponse: null,
      requiresHumanReview: true,
      recommendedAction: "DRAFT_RESPONSE",
      evidence: [{ messageId: "", quote: "Please send details" }],
      usedKnowledgeIds: []
    });
    provider.understandReply = (input) =>
      Promise.resolve({
        intent: "INTERESTED",
        confidence: 0.92,
        summary: "Prospect asked for more details over WhatsApp.",
        draftResponse: null,
        requiresHumanReview: true,
        recommendedAction: "DRAFT_RESPONSE",
        evidence: [{ messageId: input.messages.at(-1)?.id ?? "", quote: "Please send details" }],
        usedKnowledgeIds: []
      });

    const first = await ingestTwilioWhatsAppWebhook({
      body,
      signature: twilioSignature(url, body),
      url,
      env: twilioEnv(),
      replyProcessingOptions: { provider }
    });
    const second = await ingestTwilioWhatsAppWebhook({
      body,
      signature: twilioSignature(url, body),
      url,
      env: twilioEnv(),
      replyProcessingOptions: { provider }
    });

    expect(first).toMatchObject({ provider: "TWILIO_WHATSAPP", processed: 1 });
    expect(second).toMatchObject({ provider: "TWILIO_WHATSAPP", processed: 1 });
    await expect(
      prisma.message.count({ where: { providerMessageId: "SM-r24-test-twilio-inbound-001" } })
    ).resolves.toBe(1);
    await expect(
      prisma.whatsAppProviderEvent.findFirst({
        where: { provider: "TWILIO", providerMessageId: "SM-r24-test-twilio-inbound-001" }
      })
    ).resolves.toMatchObject({
      type: "INBOUND_MESSAGE"
    });
    await expect(
      prisma.replyProcessingRun.count({
        where: {
          message: { providerMessageId: "SM-r24-test-twilio-inbound-001" },
          status: "COMPLETED",
          intent: "INTERESTED"
        }
      })
    ).resolves.toBe(1);
  });
});
