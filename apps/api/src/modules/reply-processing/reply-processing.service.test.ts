import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus, type MessageSenderType } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { AppError } from "../../shared/errors.js";
import type {
  AIProvider,
  QualificationResult,
  ReplyUnderstandingResult
} from "../ai/ai.provider.js";
import { hashPassword } from "../auth/auth.service.js";
import type { EmailProvider, EmailSendInput } from "../email/email.provider.js";
import { processInboundReply } from "./reply-processing.service.js";

const actorEmail = "r10-reply-admin@example.local";
const password = "CorrectHorse123!";
const originalCalendarProvider = process.env.CALENDAR_PROVIDER;
const defaultScoringConfig = {
  key: "default",
  requirementWeight: 20,
  authorityWeight: 20,
  budgetWeight: 20,
  timelineWeight: 20,
  businessFitWeight: 20,
  warmThreshold: 60,
  hotThreshold: 80
};

class ReplyTestProvider implements AIProvider {
  public constructor(
    private readonly output: ReplyUnderstandingResult,
    private readonly salesReply: {
      body: string;
      requiresHumanReview: boolean;
      reason: string | null;
    } = {
      body: "Thanks for your interest. Based on what you shared, Shilabs can help with the next steps.",
      requiresHumanReview: false,
      reason: null
    },
    private readonly qualificationOutput: QualificationResult = {
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
    }
  ) {}
  public generateSalesReply: AIProvider["generateSalesReply"] = () =>
    Promise.resolve(this.salesReply);
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
    Promise.resolve({
      body: "test",
      requiresHumanReview: true,
      reason: null
    });
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

class TestEmailProvider implements EmailProvider {
  public calls: EmailSendInput[] = [];
  public verifyConnection: EmailProvider["verifyConnection"] = () =>
    Promise.resolve({ provider: "MAILPIT", sendingEnabled: true });
  public sendEmail(input: EmailSendInput) {
    this.calls.push(input);
    return Promise.resolve({
      provider: "MAILPIT" as const,
      providerMessageId: `mailpit-${input.idempotencyKey}`
    });
  }
}

class FailingReplyTestProvider extends ReplyTestProvider {
  public constructor() {
    super({
      intent: "UNCLEAR",
      confidence: 0.1,
      summary: "unused",
      draftResponse: null,
      requiresHumanReview: true,
      recommendedAction: "NO_ACTION",
      evidence: [],
      usedKnowledgeIds: []
    });
  }

  public override understandReply: AIProvider["understandReply"] = () =>
    Promise.reject(new Error("AI provider temporarily unavailable"));
}

class RetryableFailingReplyTestProvider extends ReplyTestProvider {
  public constructor() {
    super({
      intent: "UNCLEAR",
      confidence: 0.1,
      summary: "unused",
      draftResponse: null,
      requiresHumanReview: true,
      recommendedAction: "NO_ACTION",
      evidence: [],
      usedKnowledgeIds: []
    });
  }

  public override understandReply: AIProvider["understandReply"] = () =>
    Promise.reject(
      new AppError(503, "RETRYABLE_PROVIDER_ERROR", "AI provider temporarily unavailable")
    );
}

async function cleanup(): Promise<void> {
  await prisma.domainEventOutbox.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: "domain-event:negotiation-handoff:" } },
        { idempotencyKey: { startsWith: "domain-event:reply-processing:" } },
        { idempotencyKey: { startsWith: "domain-event:meeting-requested:" } },
        { idempotencyKey: { startsWith: "domain-event:proposal-generated:" } },
        { idempotencyKey: { startsWith: "r10-follow-up-event-" } },
        { idempotencyKey: { startsWith: "r10-calling-event-" } }
      ]
    }
  });
  await prisma.internalNotification.deleteMany({
    where: { sourceEntityType: { in: ["NegotiationHandoff", "MeetingRequest"] } }
  });
  await prisma.meetingSlot.deleteMany({
    where: { meetingRequest: { lead: { source: "r10-reply-test" } } }
  });
  await prisma.meetingRequest.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.negotiationHandoff.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.proposalGenerationRun.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.proposalStatusChange.deleteMany({
    where: { proposal: { lead: { source: "r10-reply-test" } } }
  });
  await prisma.proposalVersion.deleteMany({
    where: { proposal: { lead: { source: "r10-reply-test" } } }
  });
  await prisma.proposal.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.outboundWhatsAppMessage.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.callingAttempt.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.callingSequence.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.followUpAttempt.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.followUpSequence.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.replyProcessingRun.deleteMany({
    where: { inboundEmail: { providerMessageId: { startsWith: "ses-r10-" } } }
  });
  await prisma.leadScoreRun.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.inboundEmail.deleteMany({
    where: { providerMessageId: { startsWith: "ses-r10-" } }
  });
  await prisma.outboundEmail.deleteMany({
    where: { idempotencyKey: { startsWith: "phase1-ai-reply:" } }
  });
  await prisma.leadQualificationEvidence.deleteMany({
    where: { qualification: { lead: { source: "r10-reply-test" } } }
  });
  await prisma.leadQualification.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.message.deleteMany({
    where: { conversation: { lead: { source: "r10-reply-test" } } }
  });
  await prisma.conversation.deleteMany({ where: { lead: { source: "r10-reply-test" } } });
  await prisma.activity.deleteMany({ where: { lead: { source: "r10-reply-test" } } });
  await prisma.auditEvent.deleteMany({
    where: {
      entityType: {
        in: [
          "ReplyProcessingRun",
          "KnowledgeBaseEntry",
          "LeadQualification",
          "Lead",
          "MeetingRequest",
          "Message",
          "Proposal",
          "ProposalGenerationRun"
        ]
      }
    }
  });
  await prisma.leadScoreRun.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.lead.deleteMany({ where: { source: "r10-reply-test" } });
  await prisma.contact.deleteMany({ where: { source: "r10-reply-test" } });
  await prisma.company.deleteMany({ where: { name: { startsWith: "R10 " } } });
  await prisma.knowledgeBaseVersion.deleteMany({
    where: { entry: { key: { startsWith: "r10-" } } }
  });
  await prisma.knowledgeBaseEntry.deleteMany({ where: { key: { startsWith: "r10-" } } });
  await prisma.emailSuppression.deleteMany({
    where: { normalizedEmail: "r10-prospect@example.com" }
  });
  await prisma.authSession.deleteMany({ where: { user: { email: actorEmail } } });
  await prisma.user.deleteMany({ where: { email: actorEmail } });
}

async function seedUser(): Promise<string> {
  await prisma.scoringConfig.upsert({
    where: { key: defaultScoringConfig.key },
    create: defaultScoringConfig,
    update: defaultScoringConfig
  });
  const user = await prisma.user.create({
    data: {
      email: actorEmail,
      passwordHash: await hashPassword(password),
      firstName: "Reply",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
  return user.id;
}

async function createApprovedKnowledge(actorId: string): Promise<string> {
  const entry = await prisma.knowledgeBaseEntry.create({
    data: {
      key: `r10-service-${crypto.randomUUID()}`,
      title: "R10 Service",
      category: "SERVICE",
      status: "APPROVED",
      createdByUserId: actorId,
      updatedByUserId: actorId
    }
  });
  const version = await prisma.knowledgeBaseVersion.create({
    data: {
      entryId: entry.id,
      version: 1,
      content: "Shilabs provides approved web design and automation services.",
      sourceTitle: "Service Catalog",
      sourceType: "internal",
      createdByUserId: actorId,
      approvedByUserId: actorId,
      approvedAt: new Date()
    }
  });
  await prisma.knowledgeBaseEntry.update({
    where: { id: entry.id },
    data: { activeVersionId: version.id }
  });
  return version.id;
}

async function createInboundFixture(input?: {
  body?: string;
  senderType?: MessageSenderType;
  leadStatus?: "OPEN" | "WON" | "LOST" | "NURTURE" | "DISQUALIFIED";
  assignOwner?: boolean;
}) {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const owner =
    input?.assignOwner === false
      ? null
      : await prisma.user.findUniqueOrThrow({ where: { email: actorEmail } });
  const company = await prisma.company.create({
    data: { workspaceId: workspace.id, name: `R10 Company ${crypto.randomUUID()}` }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "R10",
      lastName: "Prospect",
      email: "r10-prospect@example.com",
      normalizedEmail: "r10-prospect@example.com",
      source: "r10-reply-test"
    }
  });
  const lead = await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      ownerId: owner?.id,
      stageId: stage.id,
      source: "r10-reply-test",
      status: input?.leadStatus ?? "OPEN",
      requirement: "Website redesign"
    }
  });
  await prisma.leadQualification.create({
    data: { leadId: lead.id, requirement: "Website redesign", businessFit: "Strong fit" }
  });
  const conversation = await prisma.conversation.create({
    data: { workspaceId: workspace.id, leadId: lead.id, channel: "EMAIL", mode: "AUTO" }
  });
  const body = input?.body ?? "Yes, please share more details about web design.";
  const message = await prisma.message.create({
    data: {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      providerMessageId: `ses-r10-${crypto.randomUUID()}`,
      direction: "INBOUND",
      senderType: input?.senderType ?? "PROSPECT",
      body,
      deliveryStatus: "DELIVERED",
      sentAt: new Date()
    }
  });
  const inbound = await prisma.inboundEmail.create({
    data: {
      workspaceId: workspace.id,
      provider: "AWS_SES",
      providerMessageId: message.providerMessageId ?? `ses-r10-${crypto.randomUUID()}`,
      leadId: lead.id,
      contactId: contact.id,
      conversationId: conversation.id,
      messageId: message.id,
      fromEmail: "r10-prospect@example.com",
      normalizedFromEmail: "r10-prospect@example.com",
      toEmails: ["sales@example.com"],
      subject: "Interested",
      textBody: body,
      rawProviderPayload: { test: true },
      status: "PROCESSED",
      replyProcessingStatus: "PENDING",
      receivedAt: new Date()
    }
  });
  return { lead, conversation, message, inbound };
}

describe("R10 reply processing", () => {
  beforeEach(async () => {
    process.env.CALENDAR_PROVIDER = "none";
    await cleanup();
    await seedUser();
  }, 90000);

  afterAll(async () => {
    if (originalCalendarProvider === undefined) {
      delete process.env.CALENDAR_PROVIDER;
    } else {
      process.env.CALENDAR_PROVIDER = originalCalendarProvider;
    }
    await cleanup();
    await prisma.$disconnect();
  }, 90000);

  it("sends one grounded AI email reply for safe interested replies", async () => {
    const actorId = await prisma.user
      .findUniqueOrThrow({ where: { email: actorEmail } })
      .then((u) => u.id);
    const knowledgeId = await createApprovedKnowledge(actorId);
    const fixture = await createInboundFixture();
    const provider = new ReplyTestProvider({
      intent: "INTERESTED",
      confidence: 0.91,
      summary: "Prospect wants more web design details.",
      draftResponse: "Thanks, happy to share the next steps.",
      requiresHumanReview: false,
      recommendedAction: "NO_ACTION",
      evidence: [{ messageId: fixture.message.id, quote: "share more details" }],
      usedKnowledgeIds: [knowledgeId]
    });
    const emailProvider = new TestEmailProvider();

    const first = await processInboundReply(fixture.inbound.id, {
      provider,
      emailProvider,
      env: { EMAIL_PROVIDER: "MAILPIT", NODE_ENV: "development" }
    });
    const second = await processInboundReply(fixture.inbound.id, {
      provider,
      emailProvider,
      env: { EMAIL_PROVIDER: "MAILPIT", NODE_ENV: "development" }
    });

    expect(first.id).toBe(second.id);
    expect(first.status).toBe("COMPLETED");
    expect(first.intent).toBe("INTERESTED");
    expect(first.recommendedAction).toBe("DRAFT_RESPONSE");
    expect(first.draftResponse).toContain("next steps");
    expect(first.requiresHumanReview).toBe(true);
    expect(emailProvider.calls).toHaveLength(1);
    expect(emailProvider.calls[0]?.textBody).toBe("Thanks, happy to share the next steps.");
    await expect(
      prisma.message.count({
        where: {
          conversationId: fixture.conversation.id,
          direction: "OUTBOUND",
          senderType: "AI",
          metadata: { path: ["replyProcessingRunId"], equals: first.id }
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.lead.findUniqueOrThrow({ where: { id: fixture.lead.id } })
    ).resolves.toMatchObject({ nextAction: "Await customer response" });
    await expect(
      prisma.inboundEmail.findUniqueOrThrow({ where: { id: fixture.inbound.id } })
    ).resolves.toMatchObject({ replyProcessingStatus: "PROCESSED" });
  }, 90000);

  it("accepts reply evidence when provider preserves exact words but normalizes whitespace", async () => {
    const fixture = await createInboundFixture({
      body: "Hi,\nThanks for reaching out. Could you tell me how it could help our sales team?"
    });
    const provider = new ReplyTestProvider({
      intent: "QUESTION",
      confidence: 0.82,
      summary: "Prospect asked how the solution helps their sales team.",
      draftResponse: "Happy to explain how it can help your sales team.",
      requiresHumanReview: true,
      recommendedAction: "DRAFT_RESPONSE",
      evidence: [
        {
          messageId: fixture.message.id,
          quote: "Hi, Thanks for reaching out. Could you tell me how it could help our sales team?"
        }
      ],
      usedKnowledgeIds: []
    });

    const result = await processInboundReply(fixture.inbound.id, { provider });

    expect(result.status).toBe("COMPLETED");
    expect(result.intent).toBe("QUESTION");
    await expect(
      prisma.inboundEmail.findUniqueOrThrow({ where: { id: fixture.inbound.id } })
    ).resolves.toMatchObject({ replyProcessingStatus: "PROCESSED" });
  }, 45000);

  it("updates qualification from reply evidence and recalculates deterministic score", async () => {
    const body =
      "We need AI sales automation for website leads. I am the founder and decision maker. Budget is INR 100000 per month and launch is within 30 days.";
    const fixture = await createInboundFixture({ body });
    const provider = new ReplyTestProvider(
      {
        intent: "INTERESTED",
        confidence: 0.94,
        summary: "Prospect shared need, authority, budget and timeline.",
        draftResponse: "Thanks, I can help with next steps.",
        requiresHumanReview: false,
        recommendedAction: "NO_ACTION",
        evidence: [{ messageId: fixture.message.id, quote: "AI sales automation" }],
        usedKnowledgeIds: []
      },
      {
        body: "Thanks for sharing those details. We can prepare the next step from here.",
        requiresHumanReview: false,
        reason: null
      },
      {
        need: "AI sales automation for website leads",
        requirement: "Automated lead follow-up and qualification",
        budget: "INR 100000 per month",
        budgetBand: "INR 100000/month",
        authority: "Founder and decision maker",
        timeline: "within 30 days",
        businessFit: "Strong fit for AI sales automation",
        decisionMakerIdentified: true,
        urgency: "High",
        evidence: [
          { messageId: fixture.message.id, quote: "AI sales automation" },
          { messageId: fixture.message.id, quote: "decision maker" },
          { messageId: fixture.message.id, quote: "INR 100000 per month" },
          { messageId: fixture.message.id, quote: "within 30 days" }
        ]
      }
    );

    const result = await processInboundReply(fixture.inbound.id, { provider });

    expect(result.status).toBe("COMPLETED");
    const qualification = await prisma.leadQualification.findUniqueOrThrow({
      where: { leadId: fixture.lead.id },
      include: { evidence: true }
    });
    expect(qualification).toMatchObject({
      need: "AI sales automation for website leads",
      requirement: "Automated lead follow-up and qualification",
      budget: "INR 100000 per month",
      authority: "Founder and decision maker",
      timeline: "within 30 days",
      decisionMakerIdentified: true
    });
    expect(qualification.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageId: fixture.message.id, quote: "AI sales automation" })
      ])
    );
    await expect(
      prisma.lead.findUniqueOrThrow({ where: { id: fixture.lead.id } })
    ).resolves.toMatchObject({
      score: 100,
      temperature: "HOT"
    });
    await expect(
      prisma.leadScoreRun.findFirstOrThrow({
        where: { leadId: fixture.lead.id, source: "RULE_ENGINE", status: "COMPLETED" }
      })
    ).resolves.toMatchObject({ actorUserId: null, score: 100, temperature: "HOT" });
  }, 45000);

  it("creates a proposal draft waiting for approval when the customer requests a proposal", async () => {
    const fixture = await createInboundFixture({
      body: "This sounds useful. Please prepare a proposal for the AI sales automation scope."
    });
    const provider = new ReplyTestProvider({
      intent: "PROPOSAL_REQUEST",
      confidence: 0.9,
      summary: "Prospect requested a proposal for AI sales automation.",
      draftResponse: "I will send the proposal now.",
      requiresHumanReview: true,
      recommendedAction: "DRAFT_RESPONSE",
      evidence: [{ messageId: fixture.message.id, quote: "prepare a proposal" }],
      usedKnowledgeIds: []
    });

    const proposalEnv = {
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "test-model",
      OPENAI_EMBEDDING_MODEL: "test-embedding-model"
    };
    const result = await processInboundReply(fixture.inbound.id, {
      provider,
      env: proposalEnv
    });
    expect(result).toMatchObject({
      status: "COMPLETED",
      intent: "PROPOSAL_REQUEST",
      recommendedAction: "PROPOSAL_REVIEW",
      draftResponse: null
    });
    await expect(
      prisma.proposalGenerationRun.findFirstOrThrow({ where: { leadId: fixture.lead.id } })
    ).resolves.toMatchObject({ status: "COMPLETED", failureCode: null, failureMessage: null });
    await expect(
      prisma.auditEvent.findFirst({
        where: {
          entityType: "ReplyProcessingRun",
          entityId: result.id,
          action: "PHASE1_ORCHESTRATION_FAILED"
        }
      })
    ).resolves.toBeNull();
    await expect(
      prisma.proposal.findFirstOrThrow({ where: { leadId: fixture.lead.id } })
    ).resolves.toMatchObject({ status: "WAITING_APPROVAL" });
    const repeated = await processInboundReply(fixture.inbound.id, {
      provider,
      env: proposalEnv
    });

    expect(repeated.id).toBe(result.id);
    await expect(prisma.outboundEmail.count({ where: { leadId: fixture.lead.id } })).resolves.toBe(
      0
    );
    await expect(
      prisma.lead.findUniqueOrThrow({ where: { id: fixture.lead.id } })
    ).resolves.toMatchObject({ nextAction: "Review AI-generated proposal" });
  }, 90000);

  it("routes negotiation to human handoff without drafting a negotiation reply", async () => {
    const actorId = await prisma.user
      .findUniqueOrThrow({ where: { email: actorEmail } })
      .then((u) => u.id);
    await createApprovedKnowledge(actorId);
    const fixture = await createInboundFixture({ body: "Your price is too high, negotiate it." });
    const provider = new ReplyTestProvider({
      intent: "NEGOTIATION",
      confidence: 0.88,
      summary: "Prospect is negotiating price.",
      draftResponse: "I can reduce the price.",
      requiresHumanReview: true,
      recommendedAction: "DRAFT_RESPONSE",
      evidence: [{ messageId: fixture.message.id, quote: "negotiate" }],
      usedKnowledgeIds: []
    });

    const result = await processInboundReply(fixture.inbound.id, { provider });
    const second = await processInboundReply(fixture.inbound.id, { provider });

    expect(second.id).toBe(result.id);
    expect(result.intent).toBe("NEGOTIATION");
    expect(result.recommendedAction).toBe("HUMAN_HANDOFF");
    expect(result.draftResponse).toBeNull();
    expect(result.humanHandoffRequired).toBe(true);
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: fixture.conversation.id } })
    ).resolves.toMatchObject({ mode: "HUMAN" });
    const handoffs = await prisma.negotiationHandoff.findMany({
      where: { replyProcessingRunId: result.id }
    });
    expect(handoffs).toHaveLength(1);
    const handoff = handoffs[0];
    if (!handoff) {
      throw new Error("Expected negotiation handoff to be created");
    }
    expect(handoff).toMatchObject({
      leadId: fixture.lead.id,
      conversationId: fixture.conversation.id,
      assignedOwnerId: actorId,
      status: "ACTIVE",
      failureCode: null
    });
    await expect(
      prisma.internalNotification.findUniqueOrThrow({
        where: { idempotencyKey: `notification:negotiation-handoff:${handoff.id}` }
      })
    ).resolves.toMatchObject({
      type: "NEGOTIATION_HANDOFF",
      status: "UNREAD",
      assignedToUserId: actorId
    });
    await expect(
      prisma.activity.findFirstOrThrow({
        where: { leadId: fixture.lead.id, type: "NEGOTIATION_HANDOFF" }
      })
    ).resolves.toMatchObject({
      description: "Negotiation detected and routed to the assigned owner"
    });
    await expect(
      prisma.auditEvent.findFirstOrThrow({
        where: { entityType: "NegotiationHandoff", action: "NEGOTIATION_HANDOFF_CREATED" }
      })
    ).resolves.toBeTruthy();
    await expect(
      prisma.domainEventOutbox.findFirstOrThrow({
        where: { aggregateType: "NegotiationHandoff", eventType: "NEGOTIATION_HANDOFF_CREATED" }
      })
    ).resolves.toMatchObject({ priority: "HIGH" });
  }, 45000);

  it("does not treat an advisory next-step question as a meeting request", async () => {
    const body =
      "Yes, we currently spend a lot of time manually following up with leads and keeping track of customer conversations. We want to automate this process while still keeping our sales team in control. What would you suggest as the next step?";
    const fixture = await createInboundFixture({ body });
    const provider = new ReplyTestProvider({
      intent: "MEETING_REQUEST",
      confidence: 0.9,
      summary: "Prospect described their automation need and asked for the suggested next step.",
      draftResponse: null,
      requiresHumanReview: true,
      recommendedAction: "MEETING_REVIEW",
      evidence: [{ messageId: fixture.message.id, quote: body }],
      usedKnowledgeIds: []
    });
    const emailProvider = new TestEmailProvider();

    const result = await processInboundReply(fixture.inbound.id, {
      provider,
      emailProvider,
      env: { EMAIL_PROVIDER: "MAILPIT", NODE_ENV: "development" }
    });

    expect(result).toMatchObject({
      status: "COMPLETED",
      intent: "QUESTION",
      recommendedAction: "DRAFT_RESPONSE",
      humanHandoffRequired: false
    });
    await expect(prisma.meetingRequest.count({ where: { leadId: fixture.lead.id } })).resolves.toBe(
      0
    );
    expect(emailProvider.calls).toHaveLength(1);
    await expect(
      prisma.lead.findUniqueOrThrow({ where: { id: fixture.lead.id } })
    ).resolves.toMatchObject({ nextAction: "Await customer response" });
  }, 45000);

  it("does not treat what-should-we-do-next wording as a meeting request", async () => {
    const body = "Thanks, this sounds relevant. What should we do next?";
    const fixture = await createInboundFixture({ body });
    const provider = new ReplyTestProvider({
      intent: "MEETING_REQUEST",
      confidence: 0.86,
      summary: "Prospect asked what they should do next.",
      draftResponse: null,
      requiresHumanReview: true,
      recommendedAction: "MEETING_REVIEW",
      evidence: [{ messageId: fixture.message.id, quote: "What should we do next?" }],
      usedKnowledgeIds: []
    });
    const emailProvider = new TestEmailProvider();

    const result = await processInboundReply(fixture.inbound.id, {
      provider,
      emailProvider,
      env: { EMAIL_PROVIDER: "MAILPIT", NODE_ENV: "development" }
    });

    expect(result.intent).toBe("QUESTION");
    expect(result.recommendedAction).toBe("DRAFT_RESPONSE");
    await expect(prisma.meetingRequest.count({ where: { leadId: fixture.lead.id } })).resolves.toBe(
      0
    );
    expect(emailProvider.calls).toHaveLength(1);
  }, 45000);

  it("sends the persisted R10 draft when a second sales-reply generation would request review", async () => {
    const body =
      "Thanks. Based on our requirement to automate lead follow-ups while keeping our sales team in control, what solution would you recommend for us?";
    const draftResponse =
      "To automate lead follow-ups while keeping your sales team in control, we recommend Shilabs AI sales automation integrated with Zoho Bigin.";
    const fixture = await createInboundFixture({ body });
    const provider = new ReplyTestProvider(
      {
        intent: "QUESTION",
        confidence: 0.95,
        summary: "Prospect asked what solution is recommended.",
        draftResponse,
        requiresHumanReview: true,
        recommendedAction: "DRAFT_RESPONSE",
        evidence: [{ messageId: fixture.message.id, quote: "what solution would you recommend" }],
        usedKnowledgeIds: []
      },
      {
        body: "This regenerated reply should not be used.",
        requiresHumanReview: true,
        reason: "Human review recommended for enterprise sales workflow discussions."
      }
    );
    const emailProvider = new TestEmailProvider();

    const result = await processInboundReply(fixture.inbound.id, {
      provider,
      emailProvider,
      env: { EMAIL_PROVIDER: "MAILPIT", NODE_ENV: "development" }
    });

    expect(result).toMatchObject({
      status: "COMPLETED",
      intent: "QUESTION",
      recommendedAction: "DRAFT_RESPONSE"
    });
    expect(emailProvider.calls).toHaveLength(1);
    expect(emailProvider.calls[0]?.textBody).toBe(draftResponse);
    await expect(
      prisma.lead.findUniqueOrThrow({ where: { id: fixture.lead.id } })
    ).resolves.toMatchObject({ nextAction: "Await customer response" });
    await expect(
      prisma.activity.count({
        where: {
          leadId: fixture.lead.id,
          description: { contains: "AI sales conversation orchestration failed" }
        }
      })
    ).resolves.toBe(0);
  }, 45000);

  it("does not send an AI reply while the conversation is in human mode", async () => {
    const fixture = await createInboundFixture({
      body: "Thanks, what solution would you recommend for our team?"
    });
    await prisma.conversation.update({
      where: { id: fixture.conversation.id },
      data: { mode: "HUMAN" }
    });
    const provider = new ReplyTestProvider({
      intent: "QUESTION",
      confidence: 0.9,
      summary: "Prospect asked for a recommendation.",
      draftResponse: "AI draft that should not be sent while human mode is active.",
      requiresHumanReview: true,
      recommendedAction: "DRAFT_RESPONSE",
      evidence: [{ messageId: fixture.message.id, quote: "what solution would you recommend" }],
      usedKnowledgeIds: []
    });
    const emailProvider = new TestEmailProvider();

    const result = await processInboundReply(fixture.inbound.id, {
      provider,
      emailProvider,
      env: { EMAIL_PROVIDER: "MAILPIT", NODE_ENV: "development" }
    });

    expect(result.intent).toBe("QUESTION");
    expect(emailProvider.calls).toHaveLength(0);
    await expect(
      prisma.message.count({
        where: { conversationId: fixture.conversation.id, direction: "OUTBOUND", senderType: "AI" }
      })
    ).resolves.toBe(0);
    await expect(
      prisma.lead.findUniqueOrThrow({ where: { id: fixture.lead.id } })
    ).resolves.toMatchObject({ nextAction: "Human follow-up required" });
  }, 45000);

  it("creates an idempotent meeting request for a meeting-request reply without booking", async () => {
    const actorId = await prisma.user
      .findUniqueOrThrow({ where: { email: actorEmail } })
      .then((u) => u.id);
    const fixture = await createInboundFixture({
      body: "Please schedule a meeting with your team so we can finalize the scope and pricing."
    });
    const provider = new ReplyTestProvider({
      intent: "MEETING_REQUEST",
      confidence: 0.92,
      summary: "Prospect asked to schedule a meeting to finalize scope and pricing.",
      draftResponse: "Here is a meeting link.",
      requiresHumanReview: true,
      recommendedAction: "DRAFT_RESPONSE",
      evidence: [{ messageId: fixture.message.id, quote: "schedule a meeting" }],
      usedKnowledgeIds: []
    });

    const result = await processInboundReply(fixture.inbound.id, { provider });
    const repeated = await processInboundReply(fixture.inbound.id, { provider });

    expect(repeated.id).toBe(result.id);
    expect(result).toMatchObject({
      status: "COMPLETED",
      intent: "MEETING_REQUEST",
      recommendedAction: "MEETING_REVIEW",
      humanHandoffRequired: true,
      draftResponse: null
    });
    await expect(
      prisma.lead.findUniqueOrThrow({
        where: { id: fixture.lead.id },
        include: { stage: true }
      })
    ).resolves.toMatchObject({ stage: { key: "QUALIFIED" } });
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: fixture.conversation.id } })
    ).resolves.toMatchObject({ mode: "HUMAN" });
    const meetings = await prisma.meetingRequest.findMany({
      where: { leadId: fixture.lead.id },
      include: { slots: true }
    });
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({
      conversationId: fixture.conversation.id,
      requestedByUserId: actorId,
      ownerId: actorId,
      status: "ATTENTION_REQUIRED",
      providerSyncStatus: "NOT_REQUIRED",
      providerLastError: "Calendar provider is not configured",
      selectedSlotId: null,
      providerMeetingId: null,
      idempotencyKey: `meeting-request:reply-processing:${result.id}`
    });
    expect(meetings[0]?.slots).toHaveLength(0);
    await expect(
      prisma.internalNotification.count({
        where: {
          leadId: fixture.lead.id,
          type: "MEETING_CONFIRMATION",
          meetingRequestId: meetings[0]?.id
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.activity.count({ where: { leadId: fixture.lead.id, type: "MEETING_REQUESTED" } })
    ).resolves.toBe(1);
    await expect(
      prisma.domainEventOutbox.count({
        where: { aggregateType: "MeetingRequest", aggregateId: meetings[0]?.id }
      })
    ).resolves.toBe(1);
  }, 90000);

  it("keeps explicit meeting scheduling requests on the meeting workflow", async () => {
    const fixture = await createInboundFixture({
      body: "Can we schedule a meeting next week to discuss implementation?"
    });
    const provider = new ReplyTestProvider({
      intent: "MEETING_REQUEST",
      confidence: 0.91,
      summary: "Prospect asked to schedule a meeting.",
      draftResponse: "Here is a meeting link.",
      requiresHumanReview: true,
      recommendedAction: "MEETING_REVIEW",
      evidence: [{ messageId: fixture.message.id, quote: "schedule a meeting" }],
      usedKnowledgeIds: []
    });

    const result = await processInboundReply(fixture.inbound.id, { provider });

    expect(result).toMatchObject({
      intent: "MEETING_REQUEST",
      recommendedAction: "MEETING_REVIEW",
      humanHandoffRequired: true,
      draftResponse: null
    });
    await expect(prisma.meetingRequest.count({ where: { leadId: fixture.lead.id } })).resolves.toBe(
      1
    );
  }, 90000);

  it("routes explicit demo or call requests through the meeting workflow", async () => {
    const fixture = await createInboundFixture({
      body: "I'd like a demo/call with your team before we move ahead."
    });
    const provider = new ReplyTestProvider({
      intent: "MEETING_REQUEST",
      confidence: 0.93,
      summary: "Prospect asked for a demo or call with the team.",
      draftResponse: "Here is a meeting link.",
      requiresHumanReview: true,
      recommendedAction: "MEETING_REVIEW",
      evidence: [{ messageId: fixture.message.id, quote: "demo/call with your team" }],
      usedKnowledgeIds: []
    });

    const result = await processInboundReply(fixture.inbound.id, { provider });

    expect(result.intent).toBe("MEETING_REQUEST");
    expect(result.recommendedAction).toBe("MEETING_REVIEW");
    await expect(prisma.meetingRequest.count({ where: { leadId: fixture.lead.id } })).resolves.toBe(
      1
    );
  }, 90000);

  it("routes ambiguous meeting-like wording to human review instead of inventing a meeting", async () => {
    const body = "This looks useful. Maybe we can move forward sometime soon.";
    const fixture = await createInboundFixture({ body });
    const provider = new ReplyTestProvider({
      intent: "MEETING_REQUEST",
      confidence: 0.68,
      summary: "Prospect used ambiguous move-forward wording.",
      draftResponse: null,
      requiresHumanReview: true,
      recommendedAction: "MEETING_REVIEW",
      evidence: [{ messageId: fixture.message.id, quote: body }],
      usedKnowledgeIds: []
    });

    const result = await processInboundReply(fixture.inbound.id, { provider });

    expect(result).toMatchObject({
      status: "COMPLETED",
      intent: "UNCLEAR",
      recommendedAction: "NO_ACTION",
      humanHandoffRequired: false,
      draftResponse: null
    });
    await expect(prisma.meetingRequest.count({ where: { leadId: fixture.lead.id } })).resolves.toBe(
      0
    );
    await expect(
      prisma.lead.findUniqueOrThrow({ where: { id: fixture.lead.id } })
    ).resolves.toMatchObject({ nextAction: "Review unclear customer reply" });
  }, 45000);

  it("applies explicit stop/DNC policy and cancels pending follow-up and calling automation", async () => {
    const fixture = await createInboundFixture({
      body: "Please unsubscribe me and stop emailing us. We are not interested."
    });
    const followUp = await prisma.followUpSequence.create({
      data: {
        leadId: fixture.lead.id,
        contactId: fixture.lead.contactId,
        conversationId: fixture.conversation.id,
        cadenceDays: [0, 1, 5, 9],
        cadenceMode: "PRODUCTION_DAYS",
        cadenceOffsetsMinutes: [0, 1440, 7200, 12960],
        idempotencyKey: `r10-follow-up-${crypto.randomUUID()}`
      }
    });
    const followUpAttempt = await prisma.followUpAttempt.create({
      data: {
        sequenceId: followUp.id,
        leadId: fixture.lead.id,
        stepIndex: 0,
        kind: "FOLLOW_UP",
        scheduledAt: new Date(Date.now() + 60_000),
        subject: "Quick follow-up",
        textBody: "Following up",
        idempotencyKey: `r10-follow-up-attempt-${crypto.randomUUID()}`
      }
    });
    const followUpEvent = await prisma.domainEventOutbox.create({
      data: {
        eventType: "FOLLOWUP_EMAIL_SEND_REQUESTED",
        aggregateType: "FollowUpAttempt",
        aggregateId: followUpAttempt.id,
        correlationId: followUp.id,
        idempotencyKey: `r10-follow-up-event-${crypto.randomUUID()}`,
        payload: { followUpAttemptId: followUpAttempt.id, leadId: fixture.lead.id }
      }
    });
    await prisma.followUpAttempt.update({
      where: { id: followUpAttempt.id },
      data: { domainEventId: followUpEvent.id }
    });
    const calling = await prisma.callingSequence.create({
      data: {
        leadId: fixture.lead.id,
        contactId: fixture.lead.contactId,
        followUpSequenceId: followUp.id,
        cadenceOffsets: [0],
        maxAttempts: 1,
        idempotencyKey: `r10-calling-${crypto.randomUUID()}`
      }
    });
    const callingAttempt = await prisma.callingAttempt.create({
      data: {
        sequenceId: calling.id,
        leadId: fixture.lead.id,
        contactId: fixture.lead.contactId,
        attemptIndex: 0,
        scheduledAt: new Date(Date.now() + 60_000),
        idempotencyKey: `r10-calling-attempt-${crypto.randomUUID()}`
      }
    });
    const callingEvent = await prisma.domainEventOutbox.create({
      data: {
        eventType: "CALL_AUTOMATION_ATTEMPT_DUE",
        aggregateType: "CallingAttempt",
        aggregateId: callingAttempt.id,
        correlationId: calling.id,
        idempotencyKey: `r10-calling-event-${crypto.randomUUID()}`,
        payload: { callingAttemptId: callingAttempt.id, leadId: fixture.lead.id }
      }
    });
    await prisma.callingAttempt.update({
      where: { id: callingAttempt.id },
      data: { domainEventId: callingEvent.id }
    });
    const provider = new ReplyTestProvider({
      intent: "NOT_INTERESTED",
      confidence: 0.96,
      summary: "Prospect explicitly asked to stop email and is not interested.",
      draftResponse: "No problem, I will stop emailing you.",
      requiresHumanReview: true,
      recommendedAction: "STOP_AUTOMATION",
      evidence: [{ messageId: fixture.message.id, quote: "stop emailing" }],
      usedKnowledgeIds: []
    });
    const emailProvider = new TestEmailProvider();

    const result = await processInboundReply(fixture.inbound.id, { provider, emailProvider });

    expect(result).toMatchObject({
      status: "COMPLETED",
      intent: "NOT_INTERESTED",
      recommendedAction: "STOP_AUTOMATION",
      draftResponse: null
    });
    expect(emailProvider.calls).toHaveLength(0);
    await expect(
      prisma.contact.findUniqueOrThrow({ where: { id: fixture.lead.contactId } })
    ).resolves.toMatchObject({
      doNotContact: true
    });
    await expect(
      prisma.emailSuppression.findUniqueOrThrow({
        where: { normalizedEmail: "r10-prospect@example.com" }
      })
    ).resolves.toMatchObject({ reason: "UNSUBSCRIBE", source: "CUSTOMER_REPLY" });
    await expect(
      prisma.followUpSequence.findUniqueOrThrow({ where: { id: followUp.id } })
    ).resolves.toMatchObject({
      status: "STOPPED",
      stopReason: "CUSTOMER_NOT_INTERESTED"
    });
    await expect(
      prisma.followUpAttempt.findUniqueOrThrow({ where: { id: followUpAttempt.id } })
    ).resolves.toMatchObject({
      status: "CANCELLED",
      failureCode: "CUSTOMER_NOT_INTERESTED"
    });
    await expect(
      prisma.callingSequence.findUniqueOrThrow({ where: { id: calling.id } })
    ).resolves.toMatchObject({
      status: "STOPPED",
      stopReason: "CUSTOMER_NOT_INTERESTED"
    });
    await expect(
      prisma.callingAttempt.findUniqueOrThrow({ where: { id: callingAttempt.id } })
    ).resolves.toMatchObject({
      status: "SKIPPED",
      failureCode: "CUSTOMER_NOT_INTERESTED"
    });
    await expect(
      prisma.domainEventOutbox.count({
        where: {
          id: { in: [followUpEvent.id, callingEvent.id] },
          status: "ATTENTION_REQUIRED",
          lastErrorCode: "CUSTOMER_NOT_INTERESTED"
        }
      })
    ).resolves.toBe(2);
  }, 90000);

  it("retries a failed reply-processing run and then creates the idempotent negotiation handoff", async () => {
    const actorId = await prisma.user
      .findUniqueOrThrow({ where: { email: actorEmail } })
      .then((u) => u.id);
    const fixture = await createInboundFixture({
      body: "The pricing is higher than expected. Please reduce the price or offer a better commercial deal."
    });
    const failed = await processInboundReply(fixture.inbound.id, {
      provider: new FailingReplyTestProvider()
    });

    expect(failed.status).toBe("FAILED");
    expect(failed.failureMessage).toBe("AI provider temporarily unavailable");
    await expect(
      prisma.negotiationHandoff.count({ where: { leadId: fixture.lead.id } })
    ).resolves.toBe(0);

    const provider = new ReplyTestProvider({
      intent: "NEGOTIATION",
      confidence: 0.93,
      summary: "Prospect wants a better commercial deal.",
      draftResponse: "I can reduce the price.",
      requiresHumanReview: true,
      recommendedAction: "DRAFT_RESPONSE",
      evidence: [{ messageId: fixture.message.id, quote: "better commercial deal" }],
      usedKnowledgeIds: []
    });
    const retried = await processInboundReply(fixture.inbound.id, { provider });
    const repeated = await processInboundReply(fixture.inbound.id, { provider });

    expect(retried.id).toBe(failed.id);
    expect(repeated.id).toBe(retried.id);
    expect(retried).toMatchObject({
      status: "COMPLETED",
      intent: "NEGOTIATION",
      recommendedAction: "HUMAN_HANDOFF",
      failureCode: null,
      failureMessage: null
    });
    expect(retried.draftResponse).toBeNull();
    await expect(
      prisma.inboundEmail.findUniqueOrThrow({ where: { id: fixture.inbound.id } })
    ).resolves.toMatchObject({ replyProcessingStatus: "PROCESSED" });
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: fixture.conversation.id } })
    ).resolves.toMatchObject({ mode: "HUMAN" });
    await expect(
      prisma.negotiationHandoff.count({
        where: { replyProcessingRunId: retried.id }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.internalNotification.count({
        where: { leadId: fixture.lead.id, type: "NEGOTIATION_HANDOFF", assignedToUserId: actorId }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.activity.count({
        where: { leadId: fixture.lead.id, type: "NEGOTIATION_HANDOFF" }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.domainEventOutbox.count({
        where: {
          aggregateType: "NegotiationHandoff",
          eventType: "NEGOTIATION_HANDOFF_CREATED"
        }
      })
    ).resolves.toBe(1);
  }, 90000);

  it("routes explicit negotiation to human handoff when the AI provider is temporarily unavailable", async () => {
    const actorId = await prisma.user
      .findUniqueOrThrow({ where: { email: actorEmail } })
      .then((u) => u.id);
    const fixture = await createInboundFixture({
      body: "The proposal looks good, but the price is too high. Can you reduce the price or offer a better commercial deal?"
    });

    const result = await processInboundReply(fixture.inbound.id, {
      provider: new RetryableFailingReplyTestProvider()
    });

    expect(result).toMatchObject({
      status: "COMPLETED",
      intent: "NEGOTIATION",
      recommendedAction: "HUMAN_HANDOFF",
      humanHandoffRequired: true,
      draftResponse: null,
      provider: "deterministic-negotiation-safety",
      failureCode: null,
      failureMessage: null
    });
    await expect(
      prisma.inboundEmail.findUniqueOrThrow({ where: { id: fixture.inbound.id } })
    ).resolves.toMatchObject({ replyProcessingStatus: "PROCESSED" });
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: fixture.conversation.id } })
    ).resolves.toMatchObject({ mode: "HUMAN" });
    await expect(
      prisma.negotiationHandoff.count({ where: { replyProcessingRunId: result.id } })
    ).resolves.toBe(1);
    await expect(
      prisma.internalNotification.count({
        where: { leadId: fixture.lead.id, type: "NEGOTIATION_HANDOFF", assignedToUserId: actorId }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.activity.count({ where: { leadId: fixture.lead.id, type: "NEGOTIATION_HANDOFF" } })
    ).resolves.toBe(1);
    await expect(
      prisma.domainEventOutbox.count({
        where: { aggregateType: "NegotiationHandoff", eventType: "NEGOTIATION_HANDOFF_CREATED" }
      })
    ).resolves.toBe(1);
  }, 90000);

  it("creates visible attention state when negotiation has no assigned owner", async () => {
    const actorId = await prisma.user
      .findUniqueOrThrow({ where: { email: actorEmail } })
      .then((u) => u.id);
    await createApprovedKnowledge(actorId);
    const fixture = await createInboundFixture({
      body: "Can you negotiate the price with us?",
      assignOwner: false
    });
    const provider = new ReplyTestProvider({
      intent: "NEGOTIATION",
      confidence: 0.9,
      summary: "Prospect asked to negotiate price.",
      draftResponse: "I can negotiate.",
      requiresHumanReview: true,
      recommendedAction: "DRAFT_RESPONSE",
      evidence: [{ messageId: fixture.message.id, quote: "negotiate" }],
      usedKnowledgeIds: []
    });

    const result = await processInboundReply(fixture.inbound.id, { provider });

    expect(result.intent).toBe("NEGOTIATION");
    expect(result.draftResponse).toBeNull();
    await expect(
      prisma.negotiationHandoff.findUniqueOrThrow({
        where: { idempotencyKey: `negotiation-handoff:reply:${result.id}` }
      })
    ).resolves.toMatchObject({
      status: "ATTENTION_REQUIRED",
      assignedOwnerId: null,
      failureCode: "OWNER_NOT_ASSIGNED"
    });
    await expect(
      prisma.internalNotification.findFirstOrThrow({
        where: { leadId: fixture.lead.id, type: "NEGOTIATION_HANDOFF" }
      })
    ).resolves.toMatchObject({
      status: "ATTENTION_REQUIRED",
      severity: "CRITICAL",
      assignedToUserId: null
    });
  }, 45000);

  it("persists failure when AI evidence is not grounded", async () => {
    const fixture = await createInboundFixture();
    const provider = new ReplyTestProvider({
      intent: "QUESTION",
      confidence: 0.7,
      summary: "Prospect asked a question.",
      draftResponse: "Sure.",
      requiresHumanReview: true,
      recommendedAction: "DRAFT_RESPONSE",
      evidence: [{ messageId: fixture.message.id, quote: "missing quote" }],
      usedKnowledgeIds: []
    });

    const result = await processInboundReply(fixture.inbound.id, { provider });

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("PROVIDER_ERROR");
    await expect(
      prisma.inboundEmail.findUniqueOrThrow({ where: { id: fixture.inbound.id } })
    ).resolves.toMatchObject({ replyProcessingStatus: "FAILED" });
  }, 45000);

  it("truthfully records missing AI configuration without fake output", async () => {
    const fixture = await createInboundFixture();

    const result = await processInboundReply(fixture.inbound.id, { env: {} });

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("AI_NOT_CONFIGURED");
    expect(result.intent).toBeNull();
    expect(result.draftResponse).toBeNull();
  }, 45000);
});
