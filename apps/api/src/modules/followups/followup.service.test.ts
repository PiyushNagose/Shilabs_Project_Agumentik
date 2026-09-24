import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import type { AIProvider, FollowUpResult } from "../ai/ai.provider.js";
import { hashPassword } from "../auth/auth.service.js";
import { startFollowUpSequence } from "./followup.service.js";

const actorEmail = "r13-followup-admin@example.local";

class FollowUpTestProvider implements AIProvider {
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
  public generateFollowUp = (): Promise<FollowUpResult> => Promise.resolve({
    body: `Personalized follow-up ${crypto.randomUUID()}`,
    requiresHumanReview: false,
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
  public understandReply: AIProvider["understandReply"] = () =>
    Promise.resolve({
      intent: "INTERESTED",
      confidence: 0.8,
      summary: "test",
      draftResponse: null,
      requiresHumanReview: true,
      recommendedAction: "DRAFT_RESPONSE",
      evidence: [],
      usedKnowledgeIds: []
    });
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

async function cleanup(): Promise<void> {
  await prisma.domainEventOutbox.deleteMany({
    where: { idempotencyKey: { startsWith: "domain-event:follow-up-attempt:" } }
  });
  await prisma.followUpAttempt.deleteMany({ where: { lead: { source: "r13-followup-test" } } });
  await prisma.followUpSequence.deleteMany({ where: { lead: { source: "r13-followup-test" } } });
  await prisma.outboundEmail.deleteMany({ where: { lead: { source: "r13-followup-test" } } });
  await prisma.inboundEmail.deleteMany({ where: { lead: { source: "r13-followup-test" } } });
  await prisma.message.deleteMany({ where: { conversation: { lead: { source: "r13-followup-test" } } } });
  await prisma.conversation.deleteMany({ where: { lead: { source: "r13-followup-test" } } });
  await prisma.auditEvent.deleteMany({
    where: { entityType: { in: ["FollowUpSequence", "FollowUpAttempt"] } }
  });
  await prisma.lead.deleteMany({ where: { source: "r13-followup-test" } });
  await prisma.contact.deleteMany({ where: { source: "r13-followup-test" } });
  await prisma.company.deleteMany({ where: { name: { startsWith: "R13 Followup" } } });
  await prisma.authSession.deleteMany({ where: { user: { email: actorEmail } } });
  await prisma.user.deleteMany({ where: { email: actorEmail } });
}

async function seedActor() {
  return prisma.user.create({
    data: {
      email: actorEmail,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: "Follow",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
}

async function seedLead(input?: { doNotContact?: boolean }) {
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({ data: { name: `R13 Followup ${crypto.randomUUID()}` } });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "R13",
      lastName: "Lead",
      email: "r13-followup@example.com",
      normalizedEmail: "r13-followup@example.com",
      source: "r13-followup-test",
      doNotContact: input?.doNotContact ?? false
    }
  });
  return prisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source: "r13-followup-test",
      requirement: "Automation project",
      serviceInterest: "AI sales automation"
    }
  });
}

describe("R13 follow-up sequence service", () => {
  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  }, 45000);

  it("creates durable first email and Day 1/5/9 attempts with domain events", async () => {
    const actor = await seedActor();
    const lead = await seedLead();

    const sequence = await startFollowUpSequence(
      actor,
      lead.id,
      { idempotencyKey: `r13-sequence-${lead.id}` },
      { provider: new FollowUpTestProvider(), now: new Date("2026-09-17T00:00:00.000Z") }
    );

    expect(sequence.status).toBe("ACTIVE");
    expect(sequence.cadenceDays).toEqual([0, 1, 5, 9]);
    expect(sequence.attempts).toHaveLength(4);
    expect(sequence.attempts.map((attempt) => attempt.kind)).toEqual([
      "FIRST_EMAIL",
      "FOLLOW_UP",
      "FOLLOW_UP",
      "FOLLOW_UP"
    ]);
    await expect(
      prisma.domainEventOutbox.count({
        where: { aggregateType: "FollowUpAttempt", correlationId: sequence.id }
      })
    ).resolves.toBe(4);
  }, 45000);

  it("persists attention-required state when eligibility blocks automation", async () => {
    const actor = await seedActor();
    const lead = await seedLead({ doNotContact: true });

    const sequence = await startFollowUpSequence(actor, lead.id, {
      idempotencyKey: `r13-blocked-${lead.id}`
    });

    expect(sequence.status).toBe("ATTENTION_REQUIRED");
    expect(sequence.lastErrorCode).toBe("CONTACT_DO_NOT_CONTACT");
    expect(sequence.attempts).toHaveLength(0);
  }, 45000);
});
