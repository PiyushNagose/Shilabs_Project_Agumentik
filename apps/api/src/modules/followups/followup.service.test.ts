import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import type { AIProvider, FollowUpResult } from "../ai/ai.provider.js";
import { hashPassword } from "../auth/auth.service.js";
import {
  accelerateFollowUpSequenceForE2E,
  listFollowUpSequencesForLead,
  startFollowUpSequence
} from "./followup.service.js";
import { autoStartLeadAiAutomation } from "./lead-ai-automation.service.js";

const actorEmail = "r13-followup-admin@example.local";
const productionTimingEnv = {
  APP_ENV: "development",
  NODE_ENV: "development",
  FOLLOW_UP_CADENCE_MODE: "production_days"
};

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
    Promise.resolve({
      summary: "test",
      buyingSignals: [],
      objections: [],
      risks: [],
      suggestedNextAction: null
    });
  public generateFollowUp = (): Promise<FollowUpResult> =>
    Promise.resolve({
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
  await prisma.message.deleteMany({
    where: { conversation: { lead: { source: "r13-followup-test" } } }
  });
  await prisma.conversation.deleteMany({ where: { lead: { source: "r13-followup-test" } } });
  await prisma.activity.deleteMany({ where: { lead: { source: "r13-followup-test" } } });
  await prisma.auditEvent.deleteMany({
    where: { entityType: { in: ["FollowUpSequence", "FollowUpAttempt", "Lead"] } }
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
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({
    data: { workspaceId: workspace.id, name: `R13 Followup ${crypto.randomUUID()}` }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
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
      workspaceId: workspace.id,
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
      {
        provider: new FollowUpTestProvider(),
        now: new Date("2026-09-17T00:00:00.000Z"),
        env: productionTimingEnv
      }
    );

    expect(sequence.status).toBe("ACTIVE");
    expect(sequence.cadenceDays).toEqual([0, 1, 5, 9]);
    expect(sequence.cadenceMode).toBe("PRODUCTION_DAYS");
    expect(sequence.cadenceOffsetsMinutes).toEqual([0, 1440, 7200, 12960]);
    expect(sequence.attempts).toHaveLength(4);
    expect(sequence.attempts.map((attempt) => attempt.scheduledAt)).toEqual([
      "2026-09-17T00:00:00.000Z",
      "2026-09-18T00:00:00.000Z",
      "2026-09-22T00:00:00.000Z",
      "2026-09-26T00:00:00.000Z"
    ]);
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
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      nextAction: "Send first follow-up email",
      nextActionAt: new Date("2026-09-17T00:00:00.000Z")
    });
  }, 45000);

  it("auto-starts AI follow-up automation for a new lead and persists the next action", async () => {
    const actor = await seedActor();
    const lead = await seedLead();

    const sequence = await autoStartLeadAiAutomation(actor, lead.id, {
      provider: new FollowUpTestProvider(),
      now: new Date("2026-09-17T00:00:00.000Z"),
      env: productionTimingEnv
    });

    expect(sequence?.status).toBe("ACTIVE");
    expect(sequence?.attempts).toHaveLength(4);
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      nextAction: "Send first follow-up email",
      nextActionAt: new Date("2026-09-17T00:00:00.000Z")
    });
    await expect(
      prisma.domainEventOutbox.count({ where: { correlationId: sequence?.id } })
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

  it("lists persisted follow-up sequences for a lead", async () => {
    const actor = await seedActor();
    const lead = await seedLead();
    const started = await startFollowUpSequence(
      actor,
      lead.id,
      { idempotencyKey: `r13-list-${lead.id}` },
      {
        provider: new FollowUpTestProvider(),
        now: new Date("2026-09-17T00:00:00.000Z"),
        env: productionTimingEnv
      }
    );

    const sequences = await listFollowUpSequencesForLead(actor, lead.id);

    expect(sequences).toHaveLength(1);
    expect(sequences[0]).toMatchObject({
      id: started.id,
      leadId: lead.id,
      status: "ACTIVE"
    });
    expect(sequences[0]?.attempts).toHaveLength(4);
  }, 45000);

  it("creates real attempts with accelerated minute offsets only in the E2E environment", async () => {
    const actor = await seedActor();
    const lead = await seedLead();

    const sequence = await startFollowUpSequence(
      actor,
      lead.id,
      { idempotencyKey: `r13-e2e-cadence-${lead.id}` },
      {
        provider: new FollowUpTestProvider(),
        now: new Date("2026-09-17T00:00:00.000Z"),
        env: {
          APP_ENV: "e2e-local",
          NODE_ENV: "development",
          FOLLOW_UP_CADENCE_MODE: "e2e_accelerated_minutes",
          FOLLOW_UP_E2E_CADENCE_MINUTES: "0,1,3,5"
        }
      }
    );

    expect(sequence.cadenceDays).toEqual([0, 1, 5, 9]);
    expect(sequence.cadenceMode).toBe("E2E_ACCELERATED_MINUTES");
    expect(sequence.cadenceOffsetsMinutes).toEqual([0, 1, 3, 5]);
    expect(sequence.attempts.map((attempt) => attempt.scheduledAt)).toEqual([
      "2026-09-17T00:00:00.000Z",
      "2026-09-17T00:01:00.000Z",
      "2026-09-17T00:03:00.000Z",
      "2026-09-17T00:05:00.000Z"
    ]);
  }, 45000);

  it("prevents accelerated timing in production", async () => {
    const actor = await seedActor();
    const lead = await seedLead();

    await expect(
      startFollowUpSequence(
        actor,
        lead.id,
        { idempotencyKey: `r13-prod-guard-${lead.id}` },
        {
          provider: new FollowUpTestProvider(),
          env: {
            APP_ENV: "e2e-local",
            NODE_ENV: "production",
            FOLLOW_UP_CADENCE_MODE: "e2e_accelerated_minutes",
            FOLLOW_UP_E2E_CADENCE_MINUTES: "0,1,3,5"
          }
        }
      )
    ).rejects.toThrow("only allowed");
  }, 45000);

  it("reschedules only pending scheduled attempts for E2E acceleration", async () => {
    const actor = await seedActor();
    const lead = await seedLead();
    const sequence = await startFollowUpSequence(
      actor,
      lead.id,
      { idempotencyKey: `r13-reschedule-${lead.id}` },
      {
        provider: new FollowUpTestProvider(),
        now: new Date("2026-09-17T00:00:00.000Z"),
        env: productionTimingEnv
      }
    );
    const firstAttempt = sequence.attempts[0];
    if (!firstAttempt) throw new Error("Expected first follow-up attempt");
    await prisma.followUpAttempt.update({
      where: { id: firstAttempt.id },
      data: { status: "SENT", sentAt: new Date("2026-09-17T00:00:30.000Z") }
    });
    await prisma.domainEventOutbox.update({
      where: { id: firstAttempt.domainEventId ?? "" },
      data: { status: "PROCESSED", processedAt: new Date("2026-09-17T00:00:30.000Z") }
    });

    const accelerated = await accelerateFollowUpSequenceForE2E(actor, sequence.id, {
      now: new Date("2026-09-17T01:00:00.000Z"),
      env: {
        APP_ENV: "e2e-local",
        NODE_ENV: "development",
        FOLLOW_UP_CADENCE_MODE: "e2e_accelerated_minutes",
        FOLLOW_UP_E2E_CADENCE_MINUTES: "0,1,3,5"
      }
    });

    expect(accelerated.cadenceMode).toBe("E2E_ACCELERATED_MINUTES");
    expect(accelerated.attempts.map((attempt) => [attempt.status, attempt.scheduledAt])).toEqual([
      ["SENT", "2026-09-17T00:00:00.000Z"],
      ["SCHEDULED", "2026-09-17T01:01:00.000Z"],
      ["SCHEDULED", "2026-09-17T01:03:00.000Z"],
      ["SCHEDULED", "2026-09-17T01:05:00.000Z"]
    ]);
    await expect(
      prisma.domainEventOutbox.findMany({
        where: { correlationId: sequence.id },
        orderBy: { nextAttemptAt: "asc" },
        select: { status: true, nextAttemptAt: true }
      })
    ).resolves.toEqual([
      { status: "PROCESSED", nextAttemptAt: new Date("2026-09-17T00:00:00.000Z") },
      { status: "PENDING", nextAttemptAt: new Date("2026-09-17T01:01:00.000Z") },
      { status: "PENDING", nextAttemptAt: new Date("2026-09-17T01:03:00.000Z") },
      { status: "PENDING", nextAttemptAt: new Date("2026-09-17T01:05:00.000Z") }
    ]);
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      nextAction: "Send follow-up email 2",
      nextActionAt: new Date("2026-09-17T01:01:00.000Z")
    });
  }, 45000);

  it("marks an existing sequence ineligible for E2E acceleration once a scheduled event is queued", async () => {
    const actor = await seedActor();
    const lead = await seedLead();
    const sequence = await startFollowUpSequence(
      actor,
      lead.id,
      { idempotencyKey: `r13-queued-ineligible-${lead.id}` },
      {
        provider: new FollowUpTestProvider(),
        now: new Date("2026-09-17T00:00:00.000Z"),
        env: productionTimingEnv
      }
    );
    const scheduledAttempt = sequence.attempts.find((attempt) => attempt.status === "SCHEDULED");
    if (!scheduledAttempt?.domainEventId) throw new Error("Expected scheduled follow-up event");
    await prisma.domainEventOutbox.update({
      where: { id: scheduledAttempt.domainEventId },
      data: { status: "QUEUED", queuedAt: new Date("2026-09-17T00:00:30.000Z") }
    });

    const [listed] = await listFollowUpSequencesForLead(actor, lead.id);

    expect(listed?.e2eAccelerationEligible).toBe(false);
    await expect(
      accelerateFollowUpSequenceForE2E(actor, sequence.id, {
        now: new Date("2026-09-17T01:00:00.000Z"),
        env: {
          APP_ENV: "e2e-local",
          NODE_ENV: "development",
          FOLLOW_UP_CADENCE_MODE: "e2e_accelerated_minutes",
          FOLLOW_UP_E2E_CADENCE_MINUTES: "0,1,3,5"
        }
      })
    ).rejects.toThrow("already been queued");
  }, 45000);
});
