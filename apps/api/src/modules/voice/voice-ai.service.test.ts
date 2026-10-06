import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { verifyExpiringVoiceStreamToken } from "@shilabs/shared-config";
import { prisma } from "../../shared/prisma.js";
import type {
  AIProvider,
  QualificationResult,
  ReplyUnderstandingResult
} from "../ai/ai.provider.js";
import { buildExotelVoicebotStreamUrl, finalizeVoiceConversationRun } from "./voice-ai.service.js";

const companyPrefix = "R22 Voice AI Company";

class VoiceAiTestProvider implements AIProvider {
  public constructor(
    private readonly output: ReplyUnderstandingResult,
    private readonly qualificationOutput: QualificationResult
  ) {}
  public generateSalesReply: AIProvider["generateSalesReply"] = () =>
    Promise.resolve({ body: "test", requiresHumanReview: true, reason: null });
  public extractQualification: AIProvider["extractQualification"] = () =>
    Promise.resolve(this.qualificationOutput);
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

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    VOICE_PROVIDER: "exotel",
    VOICE_WEBHOOK_BASE_URL: "https://voice-e2e.example.test",
    VOICE_AI_ENABLED: "true",
    VOICE_AI_OPENAI_API_KEY: "test-openai-key",
    VOICE_AI_OPENAI_MODEL: "gpt-realtime",
    VOICE_AI_OPENAI_VOICE: "alloy",
    VOICE_AI_STREAM_TOKEN: "voice-stream-token",
    EXOTEL_ACCOUNT_SID: "exotel-account",
    EXOTEL_API_KEY: "exotel-key",
    EXOTEL_API_TOKEN: "exotel-token",
    EXOTEL_API_SUBDOMAIN: "api.exotel.test",
    EXOTEL_CALLER_ID: "08000000000",
    EXOTEL_APP_URL: "https://voice-e2e.example.test/api/voice/exotel/voicebot",
    EXOTEL_AGENT_NUMBER: "",
    EXOTEL_WEBHOOK_SECRET: "test-exotel-webhook-secret",
    ...overrides
  };
}

async function cleanup(): Promise<void> {
  await prisma.voiceConversationRun.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.negotiationHandoff.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.internalNotification.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.replyProcessingRun.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.leadQualificationEvidence.deleteMany({
    where: { qualification: { lead: { company: { name: { startsWith: companyPrefix } } } } }
  });
  await prisma.message.deleteMany({
    where: { conversation: { lead: { company: { name: { startsWith: companyPrefix } } } } }
  });
  await prisma.conversation.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.voiceProviderEvent.deleteMany({
    where: { callAttempt: { lead: { company: { name: { startsWith: companyPrefix } } } } }
  });
  await prisma.voiceCallAttempt.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.domainEventOutbox.deleteMany({
    where: {
      aggregateType: { in: ["VoiceConversationRun", "ReplyProcessingRun", "NegotiationHandoff"] }
    }
  });
  await prisma.activity.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.leadQualification.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.leadScoreRun.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.auditEvent.deleteMany({
    where: {
      entityType: { in: ["VoiceConversationRun", "ReplyProcessingRun", "NegotiationHandoff"] }
    }
  });
  await prisma.lead.deleteMany({ where: { company: { name: { startsWith: companyPrefix } } } });
  await prisma.contact.deleteMany({ where: { company: { name: { startsWith: companyPrefix } } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: companyPrefix } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@r22-voice-ai.example.local" } } });
}

async function seedCall(): Promise<{ leadId: string; callSid: string }> {
  await prisma.scoringConfig.upsert({
    where: { key: "default" },
    create: {
      key: "default",
      requirementWeight: 20,
      authorityWeight: 20,
      budgetWeight: 20,
      timelineWeight: 20,
      businessFitWeight: 20,
      warmThreshold: 60,
      hotThreshold: 80
    },
    update: {}
  });
  const user = await prisma.user.create({
    data: {
      email: `${crypto.randomUUID()}@r22-voice-ai.example.local`,
      passwordHash: "not-used",
      firstName: "Voice",
      lastName: "Owner",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({
    data: { name: `${companyPrefix} ${crypto.randomUUID()}` }
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "Voice",
      lastName: "Customer",
      phone: "+91 98765 43210",
      normalizedPhone: "+919876543210"
    }
  });
  const lead = await prisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      ownerId: user.id,
      source: "R22_E2E",
      stageId: stage.id,
      requirement: "Sales automation",
      serviceInterest: "AI sales follow-up"
    }
  });
  const callSid = `exotel-call-${crypto.randomUUID()}`;
  await prisma.voiceCallAttempt.create({
    data: {
      leadId: lead.id,
      contactId: contact.id,
      actorUserId: user.id,
      provider: "EXOTEL",
      toPhone: contact.phone ?? "",
      normalizedToPhone: contact.normalizedPhone ?? "",
      fromPhone: "08000000000",
      providerCallId: callSid,
      status: "IN_PROGRESS",
      transcriptStatus: "PENDING",
      idempotencyKey: `voice-call:${callSid}`
    }
  });
  return { leadId: lead.id, callSid };
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("Exotel voice AI callback", () => {
  it("returns a signed WSS stream URL with the configured sample rate", () => {
    const response = buildExotelVoicebotStreamUrl({
      env: env(),
      query: { CallSid: "call-123", From: "+919876543210" }
    });
    const url = new URL(response.url);
    const token = url.pathname.split("/").at(-1) ?? "";
    expect(`${url.protocol}//${url.host}${url.pathname.replace(`/${token}`, "")}`).toBe(
      "wss://voice-e2e.example.test/api/voice/exotel/voicebot/stream"
    );
    expect(url.searchParams.get("sample-rate")).toBe("16000");
    expect(url.searchParams.get("CallSid")).toBe("call-123");
    expect(url.searchParams.get("From")).toBe("+919876543210");
    expect(token).not.toBe("voice-stream-token");
    expect(verifyExpiringVoiceStreamToken({ token, secret: "voice-stream-token" })).toBe(true);
  });
});

describe("voice conversation finalization", () => {
  it("persists transcript outcome and routes negotiation to the existing human handoff path", async () => {
    const { leadId, callSid } = await seedCall();
    const provider = new VoiceAiTestProvider(
      {
        intent: "NEGOTIATION",
        confidence: 0.91,
        summary: "Customer asked for a better commercial deal.",
        draftResponse: "I can reduce the price.",
        requiresHumanReview: false,
        recommendedAction: "DRAFT_RESPONSE",
        evidence: [{ messageId: "placeholder", quote: "reduce the price" }],
        usedKnowledgeIds: []
      },
      {
        need: "AI sales follow-up",
        requirement: "Sales automation",
        budget: null,
        budgetBand: null,
        authority: null,
        timeline: null,
        businessFit: "Good fit",
        decisionMakerIdentified: null,
        urgency: null,
        evidence: [{ messageId: "placeholder", quote: "AI sales follow-up" }]
      }
    );
    provider.understandReply = (input) =>
      Promise.resolve({
        intent: "NEGOTIATION",
        confidence: 0.91,
        summary: "Customer asked for a better commercial deal.",
        draftResponse: "I can reduce the price.",
        requiresHumanReview: false,
        recommendedAction: "DRAFT_RESPONSE",
        evidence: [{ messageId: input.messages[0]?.id ?? "", quote: "reduce the price" }],
        usedKnowledgeIds: []
      });
    provider.extractQualification = (input) =>
      Promise.resolve({
        need: "AI sales follow-up",
        requirement: "Sales automation",
        budget: null,
        budgetBand: null,
        authority: null,
        timeline: null,
        businessFit: "Good fit",
        decisionMakerIdentified: null,
        urgency: null,
        evidence: [{ messageId: input.messages.at(-1)?.id ?? "", quote: "AI sales follow-up" }]
      });

    await finalizeVoiceConversationRun({
      providerCallId: callSid,
      provider,
      env: env(),
      turns: [
        {
          speaker: "assistant",
          text: "Hello, this is Shilabs.",
          at: new Date().toISOString()
        },
        {
          speaker: "customer",
          text: "We need AI sales follow-up, but pricing is higher. Can you reduce the price?",
          at: new Date().toISOString()
        }
      ]
    });
    await finalizeVoiceConversationRun({
      providerCallId: callSid,
      provider,
      env: env(),
      turns: [
        {
          speaker: "customer",
          text: "We need AI sales follow-up, but pricing is higher. Can you reduce the price?",
          at: new Date().toISOString()
        }
      ]
    });

    const [run, replyRun, handoff, call, activities, messages] = await Promise.all([
      prisma.voiceConversationRun.findFirstOrThrow({ where: { leadId } }),
      prisma.replyProcessingRun.findFirstOrThrow({ where: { leadId } }),
      prisma.negotiationHandoff.findFirstOrThrow({ where: { leadId } }),
      prisma.voiceCallAttempt.findUniqueOrThrow({ where: { providerCallId: callSid } }),
      prisma.activity.findMany({ where: { leadId, type: "CALL_CONVERSATION_COMPLETED" } }),
      prisma.message.findMany({ where: { conversation: { leadId } } })
    ]);
    expect(run.status).toBe("COMPLETED");
    expect(run.intent).toBe("NEGOTIATION");
    expect(run.humanHandoffRequired).toBe(true);
    expect(run.transcriptText).toContain("Customer:");
    expect(replyRun.intent).toBe("NEGOTIATION");
    expect(replyRun.recommendedAction).toBe("HUMAN_HANDOFF");
    expect(replyRun.draftResponse).toBeNull();
    expect(handoff.status).toBe("ACTIVE");
    expect(call.transcriptStatus).toBe("AVAILABLE");
    expect(messages).toHaveLength(1);
    expect(activities).toHaveLength(1);
  });
});
