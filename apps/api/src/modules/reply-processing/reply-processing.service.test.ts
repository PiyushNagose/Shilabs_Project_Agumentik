import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus, type MessageSenderType } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { AppError } from "../../shared/errors.js";
import type { AIProvider, QualificationResult, ReplyUnderstandingResult } from "../ai/ai.provider.js";
import { hashPassword } from "../auth/auth.service.js";
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
  public generateSalesReply: AIProvider["generateSalesReply"] = () => Promise.resolve({
    body: "test",
    requiresHumanReview: true,
    reason: null
  });
  public extractQualification: AIProvider["extractQualification"] = () =>
    Promise.resolve(this.qualificationOutput);
  public summarizeLead: AIProvider["summarizeLead"] = () => Promise.resolve({
    summary: "test",
    buyingSignals: [],
    objections: [],
    risks: [],
    suggestedNextAction: null
  });
  public generateFollowUp: AIProvider["generateFollowUp"] = () => Promise.resolve({
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
        { idempotencyKey: { startsWith: "domain-event:meeting-requested:" } }
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
  await prisma.replyProcessingRun.deleteMany({
    where: { inboundEmail: { providerMessageId: { startsWith: "ses-r10-" } } }
  });
  await prisma.leadScoreRun.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.inboundEmail.deleteMany({
    where: { providerMessageId: { startsWith: "ses-r10-" } }
  });
  await prisma.leadQualificationEvidence.deleteMany({
    where: { qualification: { lead: { source: "r10-reply-test" } } }
  });
  await prisma.leadQualification.deleteMany({
    where: { lead: { source: "r10-reply-test" } }
  });
  await prisma.message.deleteMany({
    where: { providerMessageId: { startsWith: "ses-r10-" } }
  });
  await prisma.conversation.deleteMany({ where: { lead: { source: "r10-reply-test" } } });
  await prisma.activity.deleteMany({ where: { lead: { source: "r10-reply-test" } } });
  await prisma.auditEvent.deleteMany({
    where: {
      entityType: {
        in: ["ReplyProcessingRun", "KnowledgeBaseEntry", "LeadQualification", "Lead", "MeetingRequest"]
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
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const owner =
    input?.assignOwner === false
      ? null
      : await prisma.user.findUniqueOrThrow({ where: { email: actorEmail } });
  const company = await prisma.company.create({ data: { name: `R10 Company ${crypto.randomUUID()}` } });
  const contact = await prisma.contact.create({
    data: {
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
    data: { leadId: lead.id, channel: "EMAIL", mode: "AUTO" }
  });
  const body = input?.body ?? "Yes, please share more details about web design.";
  const message = await prisma.message.create({
    data: {
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
  }, 45000);

  it("persists grounded reply understanding and draft without sending", async () => {
    const actorId = await prisma.user.findUniqueOrThrow({ where: { email: actorEmail } }).then((u) => u.id);
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

    const first = await processInboundReply(fixture.inbound.id, { provider });
    const second = await processInboundReply(fixture.inbound.id, { provider });

    expect(first.id).toBe(second.id);
    expect(first.status).toBe("COMPLETED");
    expect(first.intent).toBe("INTERESTED");
    expect(first.recommendedAction).toBe("DRAFT_RESPONSE");
    expect(first.draftResponse).toContain("next steps");
    expect(first.requiresHumanReview).toBe(true);
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
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: fixture.lead.id } })).resolves.toMatchObject({
      score: 100,
      temperature: "HOT"
    });
    await expect(
      prisma.leadScoreRun.findFirstOrThrow({
        where: { leadId: fixture.lead.id, source: "RULE_ENGINE", status: "COMPLETED" }
      })
    ).resolves.toMatchObject({ actorUserId: null, score: 100, temperature: "HOT" });
  }, 45000);

  it("routes negotiation to human handoff without drafting a negotiation reply", async () => {
    const actorId = await prisma.user.findUniqueOrThrow({ where: { email: actorEmail } }).then((u) => u.id);
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
    ).resolves.toMatchObject({ description: "Negotiation detected and routed to the assigned owner" });
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

  it("creates an idempotent meeting request for a meeting-request reply without booking", async () => {
    const actorId = await prisma.user.findUniqueOrThrow({ where: { email: actorEmail } }).then((u) => u.id);
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
        where: { leadId: fixture.lead.id, type: "MEETING_CONFIRMATION", meetingRequestId: meetings[0]?.id }
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

  it("retries a failed reply-processing run and then creates the idempotent negotiation handoff", async () => {
    const actorId = await prisma.user.findUniqueOrThrow({ where: { email: actorEmail } }).then((u) => u.id);
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
    const actorId = await prisma.user.findUniqueOrThrow({ where: { email: actorEmail } }).then((u) => u.id);
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
    const actorId = await prisma.user.findUniqueOrThrow({ where: { email: actorEmail } }).then((u) => u.id);
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
