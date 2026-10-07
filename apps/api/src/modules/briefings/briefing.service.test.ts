import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus, type MeetingRequest } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import type { AIProvider, BriefingResult } from "../ai/ai.provider.js";
import {
  generateLeadBriefing,
  generateMeetingBriefing,
  listBriefings
} from "./briefing.service.js";

const actorEmail = "r26-briefing-admin@example.local";
const source = "r26-briefing-test";

class BriefingTestProvider implements AIProvider {
  public constructor(private readonly output: BriefingResult) {}
  public generateSalesReply: AIProvider["generateSalesReply"] = () =>
    Promise.resolve({ body: "test", requiresHumanReview: true, reason: null });
  public extractQualification: AIProvider["extractQualification"] = () =>
    Promise.resolve({
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
  public summarizeLead: AIProvider["summarizeLead"] = () =>
    Promise.resolve({ summary: "test", buyingSignals: [], objections: [], risks: [], suggestedNextAction: null });
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
  public understandReply: AIProvider["understandReply"] = () =>
    Promise.resolve({
      intent: "INTERESTED",
      confidence: 0.9,
      summary: "test",
      draftResponse: null,
      requiresHumanReview: true,
      recommendedAction: "DRAFT_RESPONSE",
      evidence: [],
      usedKnowledgeIds: []
    });
  public generateBriefing: AIProvider["generateBriefing"] = () => Promise.resolve(this.output);
  public createEmbedding: AIProvider["createEmbedding"] = () => Promise.resolve([0.1]);
}

async function cleanup(): Promise<void> {
  await prisma.domainEventOutbox.deleteMany({ where: { aggregateType: "BriefingRun" } });
  await prisma.auditEvent.deleteMany({ where: { entityType: "BriefingRun" } });
  await prisma.briefingRun.deleteMany({ where: { lead: { source } } });
  await prisma.activity.deleteMany({ where: { lead: { source } } });
  await prisma.meetingSlot.deleteMany({ where: { meetingRequest: { lead: { source } } } });
  await prisma.meetingRequest.deleteMany({ where: { lead: { source } } });
  await prisma.leadQualification.deleteMany({ where: { lead: { source } } });
  await prisma.message.deleteMany({ where: { conversation: { lead: { source } } } });
  await prisma.conversation.deleteMany({ where: { lead: { source } } });
  await prisma.lead.deleteMany({ where: { source } });
  await prisma.contact.deleteMany({ where: { source } });
  await prisma.company.deleteMany({ where: { name: { startsWith: "R26 Briefing" } } });
  await prisma.knowledgeBaseVersion.deleteMany({ where: { sourceTitle: "R26 Briefing Test" } });
  await prisma.knowledgeBaseEntry.deleteMany({ where: { key: { startsWith: "r26-briefing" } } });
  await prisma.authSession.deleteMany({ where: { user: { email: actorEmail } } });
  await prisma.user.deleteMany({ where: { email: actorEmail } });
}

async function seedBase(): Promise<{ actor: Awaited<ReturnType<typeof prisma.user.create>>; leadId: string; kbVersionId: string }> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  await prisma.pipelineStage.upsert({
    where: { key: "R26_BRIEFING_NEW" },
    update: {},
    create: { key: "R26_BRIEFING_NEW", label: "R26 Briefing New", order: 9260, probability: 10 }
  });
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "R26_BRIEFING_NEW" } });
  const actor = await prisma.user.create({
    data: {
      email: actorEmail,
      passwordHash: "test-password-hash",
      firstName: "R26",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
  const company = await prisma.company.create({
    data: { workspaceId: workspace.id, name: "R26 Briefing Company" }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "R26",
      lastName: "Prospect",
      email: "r26.prospect@example.local",
      normalizedEmail: "r26.prospect@example.local",
      source
    }
  });
  const lead = await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      ownerId: actor.id,
      stageId: stage.id,
      source,
      requirement: "Need AI automation",
      serviceInterest: "AI sales automation",
      score: 80,
      temperature: "HOT"
    }
  });
  await prisma.leadQualification.create({
    data: {
      leadId: lead.id,
      need: "AI automation",
      requirement: "Need AI automation",
      budget: null,
      timeline: null
    }
  });
  const conversation = await prisma.conversation.create({
    data: { workspaceId: workspace.id, leadId: lead.id, channel: "EMAIL", mode: "HUMAN" }
  });
  await prisma.message.create({
    data: {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      direction: "INBOUND",
      senderType: "PROSPECT",
      body: "We need a proposal for AI automation but budget is not confirmed."
    }
  });
  const kb = await prisma.knowledgeBaseEntry.create({
    data: {
      key: "r26-briefing-service",
      title: "R26 briefing service",
      category: "SERVICE",
      status: "APPROVED",
      createdByUserId: actor.id,
      updatedByUserId: actor.id,
      versions: {
        create: {
          version: 1,
          content: "AI sales automation can qualify leads and draft follow-up content with human approval.",
          sourceTitle: "R26 Briefing Test",
          sourceType: "E2E_TEST",
          createdByUserId: actor.id,
          approvedByUserId: actor.id,
          approvedAt: new Date()
        }
      }
    },
    include: { versions: true }
  });
  const kbVersion = kb.versions[0];
  if (!kbVersion) throw new Error("KB version missing");
  await prisma.knowledgeBaseEntry.update({
    where: { id: kb.id },
    data: { activeVersionId: kbVersion.id }
  });
  return { actor, leadId: lead.id, kbVersionId: kbVersion.id };
}

async function seedMeeting(leadId: string, actorId: string): Promise<MeetingRequest> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  const request = await prisma.meetingRequest.create({
    data: {
      workspaceId: lead.workspaceId,
      leadId,
      contactId: lead.contactId,
      ownerId: actorId,
      requestedByUserId: actorId,
      status: "CONFIRMED",
      title: "R26 customer meeting",
      timeZone: "Asia/Kolkata",
      durationMinutes: 30,
      slotMinutes: 30,
      windowStart: new Date("2026-10-01T04:00:00.000Z"),
      windowEnd: new Date("2026-10-01T05:00:00.000Z"),
      provider: "GOOGLE_CALENDAR",
      providerSyncStatus: "SYNCED",
      zohoSyncStatus: "NOT_CONFIGURED",
      idempotencyKey: `r26-meeting:${leadId}`
    }
  });
  await prisma.meetingSlot.create({
    data: {
      meetingRequestId: request.id,
      startsAt: new Date("2026-10-01T04:00:00.000Z"),
      endsAt: new Date("2026-10-01T04:30:00.000Z"),
      timeZone: "Asia/Kolkata",
      status: "SELECTED"
    }
  });
  return request;
}

describe("R26 briefing service", () => {
  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("persists a grounded lead briefing with audit/activity/domain-event evidence", async () => {
    const { actor, leadId, kbVersionId } = await seedBase();
    const output: BriefingResult = {
      summary: "Lead needs AI automation.",
      requirements: "Need AI automation",
      budget: null,
      timeline: null,
      decisionContext: null,
      recentCommunication: "Prospect needs a proposal.",
      qualification: "AI automation need is captured.",
      proposalDealContext: null,
      meetingContext: null,
      recommendedNextAction: "Prepare human-reviewed next steps.",
      usedKnowledgeIds: [kbVersionId],
      evidence: [
        { sourceId: `lead:${leadId}`, quote: "Need AI automation" },
        { sourceId: kbVersionId, quote: "human approval" }
      ],
      requiresHumanReview: true,
      unknowns: ["budget", "timeline"]
    };

    const run = await generateLeadBriefing(
      actor,
      leadId,
      { idempotencyKey: "r26-lead-briefing-001" },
      { provider: new BriefingTestProvider(output) }
    );

    expect(run.status).toBe("COMPLETED");
    expect(run.summary).toContain("AI automation");
    expect(run.recommendedNextAction).toContain("Prepare");
    await expect(prisma.activity.count({ where: { leadId, type: "BRIEFING_GENERATED" } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { entityId: run.id, action: "BRIEFING_GENERATED" } })).resolves.toBe(1);
    await expect(prisma.domainEventOutbox.count({ where: { aggregateId: run.id, eventType: "BRIEFING_GENERATED" } })).resolves.toBe(1);
    await expect(listBriefings(actor, { leadId, limit: 10 })).resolves.toHaveLength(1);
  });

  it("accepts briefing evidence when provider preserves exact words but normalizes whitespace", async () => {
    const { actor, leadId } = await seedBase();
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { leadId } });
    const message = await prisma.message.create({
      data: {
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "PROSPECT",
        body: "Hi,\nWe need AI automation for sales follow-ups."
      }
    });
    const output: BriefingResult = {
      summary: "Lead needs AI automation.",
      requirements: "Need AI automation",
      budget: null,
      timeline: null,
      decisionContext: null,
      recentCommunication: "Prospect discussed AI automation.",
      qualification: "AI automation need is captured.",
      proposalDealContext: null,
      meetingContext: null,
      recommendedNextAction: "Prepare human-reviewed next steps.",
      usedKnowledgeIds: [],
      evidence: [
        {
          sourceId: `message:${message.id}`,
          quote: "Hi, We need AI automation for sales follow-ups."
        }
      ],
      requiresHumanReview: true,
      unknowns: ["budget", "timeline"]
    };

    const run = await generateLeadBriefing(
      actor,
      leadId,
      { idempotencyKey: "r26-lead-briefing-whitespace-grounded" },
      { provider: new BriefingTestProvider(output) }
    );

    expect(run.status).toBe("COMPLETED");
    expect(run.summary).toContain("AI automation");
  });

  it("generates meeting briefings without mutating meeting state", async () => {
    const { actor, leadId } = await seedBase();
    const request = await seedMeeting(leadId, actor.id);
    const output: BriefingResult = {
      summary: "Meeting is confirmed.",
      requirements: "Need AI automation",
      budget: null,
      timeline: null,
      decisionContext: null,
      recentCommunication: "Discuss proposal request.",
      qualification: null,
      proposalDealContext: null,
      meetingContext: "R26 customer meeting is confirmed.",
      recommendedNextAction: "Prepare agenda.",
      usedKnowledgeIds: [],
      evidence: [{ sourceId: `meeting:${request.id}`, quote: "R26 customer meeting" }],
      requiresHumanReview: true,
      unknowns: ["budget"]
    };

    const run = await generateMeetingBriefing(
      actor,
      request.id,
      { idempotencyKey: "r26-meeting-briefing-001" },
      { provider: new BriefingTestProvider(output) }
    );
    const unchanged = await prisma.meetingRequest.findUniqueOrThrow({ where: { id: request.id } });

    expect(run.status).toBe("COMPLETED");
    expect(run.meetingRequestId).toBe(request.id);
    expect(unchanged.status).toBe("CONFIRMED");
    expect(unchanged.providerSyncStatus).toBe("SYNCED");
  });

  it("persists failed briefing runs when AI output is ungrounded", async () => {
    const { actor, leadId } = await seedBase();
    const output: BriefingResult = {
      summary: "Invented",
      requirements: null,
      budget: "100000",
      timeline: "one week",
      decisionContext: null,
      recentCommunication: "Invented",
      qualification: null,
      proposalDealContext: null,
      meetingContext: null,
      recommendedNextAction: null,
      usedKnowledgeIds: ["unapproved"],
      evidence: [{ sourceId: "missing", quote: "not real" }],
      requiresHumanReview: true,
      unknowns: []
    };

    const run = await generateLeadBriefing(
      actor,
      leadId,
      { idempotencyKey: "r26-lead-briefing-failed" },
      { provider: new BriefingTestProvider(output) }
    );

    expect(run.status).toBe("FAILED");
    expect(run.failureCode).toBe("PROVIDER_ERROR");
    await expect(prisma.activity.count({ where: { leadId, type: "BRIEFING_GENERATED" } })).resolves.toBe(0);
    await expect(prisma.auditEvent.count({ where: { entityId: run.id, action: "BRIEFING_FAILED" } })).resolves.toBe(1);
  });
});
