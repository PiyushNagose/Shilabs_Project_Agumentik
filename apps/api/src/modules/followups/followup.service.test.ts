import crypto from "node:crypto";
import request from "supertest";
import { createApp } from "../../app.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import type { AIProvider, FollowUpResult } from "../ai/ai.provider.js";
import { hashPassword } from "../auth/auth.service.js";
import { prepareFollowUpDraft } from "./followup-draft.service.js";
import {
  accelerateFollowUpSequenceForE2E,
  assertSafeFollowUpDraft,
  listFollowUpSequencesForLead,
  runCallingAttemptNowForE2E,
  startFollowUpSequence
} from "./followup.service.js";
import {
  autoStartLeadAiAutomation,
  shouldAutoStartLeadAiAutomation
} from "./lead-ai-automation.service.js";
import {
  createFollowUpPolicy,
  listFollowUpPolicies,
  updateFollowUpPolicy
} from "./followup-policy.service.js";

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
  public generateFollowUp: AIProvider["generateFollowUp"] = (): Promise<FollowUpResult> =>
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

class RecordingFollowUpProvider extends FollowUpTestProvider {
  public readonly contexts: unknown[] = [];

  public override generateFollowUp: AIProvider["generateFollowUp"] = (input) => {
    this.contexts.push(JSON.parse(input.leadContext) as unknown);
    return Promise.resolve({
      body: `Grounded personalized follow-up ${crypto.randomUUID()}`,
      requiresHumanReview: false,
      reason: null
    });
  };
}

async function cleanup(): Promise<void> {
  await prisma.domainEventOutbox.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: "domain-event:calling-attempt:" } },
        { idempotencyKey: { startsWith: "domain-event:whatsapp-send:" } }
      ],
      aggregateId: {
        in: (
          await prisma.callingAttempt.findMany({
            where: { lead: { source: "r13-followup-test" } },
            select: { id: true }
          })
        ).map(({ id }) => id)
      }
    }
  });
  await prisma.outboundWhatsAppMessage.deleteMany({
    where: { lead: { source: "r13-followup-test" } }
  });
  await prisma.voiceProviderEvent.deleteMany({
    where: { callAttempt: { lead: { source: "r13-followup-test" } } }
  });
  await prisma.callingAttempt.deleteMany({ where: { lead: { source: "r13-followup-test" } } });
  await prisma.callingSequence.deleteMany({ where: { lead: { source: "r13-followup-test" } } });
  await prisma.voiceCallAttempt.deleteMany({ where: { lead: { source: "r13-followup-test" } } });
  await prisma.domainEventOutbox.deleteMany({
    where: { idempotencyKey: { startsWith: "domain-event:follow-up-attempt:" } }
  });
  await prisma.followUpAttempt.deleteMany({ where: { lead: { source: "r13-followup-test" } } });
  await prisma.followUpSequence.deleteMany({ where: { lead: { source: "r13-followup-test" } } });
  await prisma.followUpPolicy.deleteMany({ where: { name: { startsWith: "R13 Policy" } } });
  await prisma.followUpPolicy.updateMany({
    where: { name: "Default follow-up" },
    data: { enabled: true, isDefault: true, cadenceDays: [0, 1, 5, 9] }
  });
  await prisma.workspace.deleteMany({ where: { slug: { startsWith: "r13-policy-isolation-" } } });
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

async function seedLead(input?: {
  doNotContact?: boolean;
  serviceInterest?: string;
  leadType?: string;
  country?: string;
  priority?: string;
  campaign?: string;
}) {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({
    data: {
      workspaceId: workspace.id,
      name: `R13 Followup ${crypto.randomUUID()}`,
      location: input?.country
    }
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
      leadType: input?.leadType,
      country: input?.country,
      priority: input?.priority,
      campaign: input?.campaign,
      automationOwnershipState: "AI_ACTIVE",
      requirement: "Automation project",
      serviceInterest: input?.serviceInterest ?? "AI sales automation"
    }
  });
}

describe("R13 follow-up sequence service", () => {
  it.each([true, false])("hands failed startup back to a person (review requested: %s)", async (review) => {
    const actor = await seedActor();
    const lead = await seedLead();
    const provider = new FollowUpTestProvider();
    provider.generateFollowUp = () => {
      if (!review) throw new Error("Provider is unavailable");
      return Promise.resolve({ body: "A commercial change needs approval.", requiresHumanReview: true, reason: "Approval required" });
    };
    const sequence = await autoStartLeadAiAutomation(actor, lead.id, {
      provider, env: { ...productionTimingEnv, AI_AUTOSTART_ON_LEAD_CREATE: "true" }
    });
    expect(sequence?.status).toBe("ATTENTION_REQUIRED");
    if (review) {
      expect(sequence?.reviewDraft).toMatchObject({ body: "A commercial change needs approval.", reason: "Approval required" });
      const persisted = await listFollowUpSequencesForLead(actor, lead.id);
      expect(persisted[0]?.reviewDraft).toEqual(sequence?.reviewDraft);
      expect(sequence?.attempts[0]?.status).toBe("BLOCKED");
      expect(sequence?.attempts[0]?.domainEventId).toBeNull();
    }
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      automationOwnershipState: "HUMAN_REQUIRED",
      nextAction: review ? "Review the suggested follow-up before replying" : "Review automatic follow-up settings"
    });
    expect(await prisma.activity.count({ where: { leadId: lead.id, type: "MESSAGE_RECEIVED" } })).toBe(0);
    expect(await prisma.activity.findFirst({ where: { leadId: lead.id, type: "FOLLOW_UP_DECISION_RECORDED" } })).toMatchObject({
      workspaceId: lead.workspaceId,
      title: review ? "Follow-up needs your review" : "Automatic follow-up needs attention"
    });
    expect(await prisma.auditEvent.count({ where: { entityId: lead.id, action: "AI_LEAD_AUTOMATION_STARTED" } })).toBe(0);
  });

  it("does not overwrite a terminal state reached during draft generation", async () => {
    const actor = await seedActor();
    const lead = await seedLead();
    const provider = new FollowUpTestProvider();
    provider.generateFollowUp = async () => {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "WON", automationOwnershipState: "AI_STOPPED", nextAction: "Arrange onboarding" } });
      return { body: "A commercial change needs approval.", requiresHumanReview: true, reason: null };
    };
    await autoStartLeadAiAutomation(actor, lead.id, {
      provider, env: { ...productionTimingEnv, AI_AUTOSTART_ON_LEAD_CREATE: "true" }
    });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      status: "WON", automationOwnershipState: "AI_STOPPED", nextAction: "Arrange onboarding"
    });
  });

  it("keeps a promised future contact date and the spacing between later follow-ups", async () => {
    const actor = await seedActor();
    const lead = await seedLead();
    const now = new Date("2026-10-20T09:00:00Z");
    const promisedAt = new Date("2026-11-01T09:00:00Z");
    await prisma.lead.update({
      where: { id: lead.id },
      data: { nextAction: "Reply on the promised date", nextActionAt: promisedAt }
    });
    const sequence = await startFollowUpSequence(
      actor,
      lead.id,
      { idempotencyKey: `promised:${lead.id}` },
      { provider: new FollowUpTestProvider(), now }
    );
    expect(sequence.status).toBe("ACTIVE");
    expect(sequence.attempts.map((attempt) => attempt.scheduledAt)).toEqual([
      promisedAt.toISOString(),
      "2026-11-05T09:00:00.000Z",
      "2026-11-09T09:00:00.000Z"
    ]);
    expect(await prisma.lead.findUnique({ where: { id: lead.id } })).toMatchObject({
      nextActionAt: promisedAt
    });
  });
  it.each(["PHONE", "WHATSAPP"] as const)(
    "starts %s follow-up without requiring an email address",
    async (preferredChannel) => {
      const actor = await seedActor();
      const lead = await seedLead();
      if (!lead.workspaceId) throw new Error("Fixture workspace is missing");
      await prisma.contact.update({
        where: { id: lead.contactId },
        data: { email: null, normalizedEmail: null, phone: "+15551234567" }
      });
      await prisma.leadIntelligence.create({
        data: {
          workspaceId: lead.workspaceId,
          leadId: lead.id,
          preferredChannel,
          contextSnapshot: {},
          evidence: []
        }
      });
      const sequence = await startFollowUpSequence(
        actor,
        lead.id,
        { idempotencyKey: `channel:${lead.id}` },
        { provider: new FollowUpTestProvider() }
      );
      expect(sequence.status).toBe("ACTIVE");
      expect(sequence.attempts).toHaveLength(3);
    }
  );
  it("requires internal authentication before accepting a draft preparation request", async () => {
    await request(createApp())
      .post("/api/followups/internal/prepare")
      .send({ workspaceId: "workspace-a", attemptId: "attempt-a" })
      .expect(401);
    await request(createApp())
      .post("/api/followups/internal/prepare")
      .set("x-shilabs-realtime-secret", process.env.REALTIME_INTERNAL_SECRET ?? "")
      .send({ workspaceId: "workspace-a", attemptId: "attempt-a" })
      .expect(404);
  });
  it("retrieves new cross-channel messages and lead requirements at send time", async () => {
    const actor = await seedActor();
    const lead = await seedLead();
    const provider = new RecordingFollowUpProvider();
    const sequence = await startFollowUpSequence(
      { ...actor, activeWorkspaceId: lead.workspaceId ?? undefined },
      lead.id,
      { idempotencyKey: `r13-fresh-${lead.id}` },
      { provider, env: productionTimingEnv, now: new Date(Date.now() - 15 * 86_400_000) }
    );
    await prisma.lead.update({
      where: { id: lead.id },
      data: { requirement: "Updated: include an approval dashboard" }
    });
    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: null,
        leadId: lead.id,
        channel: "WHATSAPP",
        mode: "AUTO"
      }
    });
    await prisma.message.create({
      data: {
        workspaceId: null,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "USER",
        body: "I shared the revised dashboard scope on WhatsApp."
      }
    });
    const messages: string[] = [];
    provider.generateFollowUp = (input) => {
      provider.contexts.push(JSON.parse(input.leadContext) as unknown);
      messages.push(...input.messages.map((item) => item.body));
      return Promise.resolve({
        body: "The revised dashboard scope is ready for review.",
        requiresHumanReview: false,
        reason: null
      });
    };
    const attemptId = sequence.attempts[0]?.id ?? "";
    await expect(
      prepareFollowUpDraft(lead.workspaceId ?? "", attemptId, { provider })
    ).resolves.toMatchObject({ textBody: "The revised dashboard scope is ready for review." });
    expect(provider.contexts.at(-1)).toMatchObject({
      requirement: "Updated: include an approval dashboard"
    });
    expect(messages).toContain("I shared the revised dashboard scope on WhatsApp.");
    await expect(
      prepareFollowUpDraft("another-workspace", attemptId, { provider })
    ).rejects.toThrow("Follow-up attempt not found");
  }, 45000);

  it("stops automation for a draft requiring human approval", async () => {
    const actor = await seedActor();
    const lead = await seedLead();
    const provider = new FollowUpTestProvider();
    const sequence = await startFollowUpSequence(
      { ...actor, activeWorkspaceId: lead.workspaceId ?? undefined },
      lead.id,
      { idempotencyKey: `r13-review-${lead.id}` },
      { provider, env: productionTimingEnv, now: new Date(Date.now() - 15 * 86_400_000) }
    );
    provider.generateFollowUp = () =>
      Promise.resolve({
        body: "Proposed commercial change",
        requiresHumanReview: true,
        reason: "Pricing needs approval"
      });
    await expect(
      prepareFollowUpDraft(lead.workspaceId ?? "", sequence.attempts[0]?.id ?? "", { provider })
    ).rejects.toThrow("A salesperson must review this follow-up");
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      automationOwnershipState: "HUMAN_REQUIRED"
    });
    expect(
      await prisma.followUpAttempt.count({ where: { leadId: lead.id, status: "SCHEDULED" } })
    ).toBe(0);
    expect((await listFollowUpSequencesForLead(actor, lead.id))[0]?.reviewDraft).toMatchObject({
      body: "Proposed commercial change", reason: "Pricing needs approval"
    });
  }, 45000);
  it("blocks an AI follow-up draft that impersonates the lead", () => {
    expect(() =>
      assertSafeFollowUpDraft(
        "Hi Development Admin, thank you for following up. Best regards, Rhea Malhotra",
        "Rhea Malhotra"
      )
    ).toThrow("AI follow-up draft appeared to impersonate the customer");
    expect(() =>
      assertSafeFollowUpDraft(
        "Hi Rhea, following up on your CRM requirements. Best regards, Shilabs",
        "Rhea Malhotra"
      )
    ).not.toThrow();
  });

  it("enables automatic follow-up in the real local E2E environment", () => {
    expect(shouldAutoStartLeadAiAutomation({ APP_ENV: "e2e-local", NODE_ENV: "test" })).toBe(true);
    expect(
      shouldAutoStartLeadAiAutomation({
        APP_ENV: "e2e-local",
        NODE_ENV: "test",
        AI_AUTOSTART_ON_LEAD_CREATE: "false"
      })
    ).toBe(false);
  });

  it("creates a workspace-scoped first call and WhatsApp attempt for local E2E", async () => {
    const actor = await seedActor();
    const lead = await seedLead();
    const now = new Date("2026-10-19T08:00:00.000Z");

    const result = await runCallingAttemptNowForE2E(actor, lead.id, {
      now,
      env: {
        APP_ENV: "e2e-local",
        NODE_ENV: "test",
        FOLLOW_UP_CADENCE_MODE: "e2e_accelerated_minutes"
      }
    });

    expect(result).toMatchObject({ status: "ACCELERATED", scheduledAt: now.toISOString() });
    const events = await prisma.domainEventOutbox.findMany({
      where: { aggregateId: result.attemptId },
      orderBy: { eventType: "asc" }
    });
    expect(events.map(({ eventType }) => eventType)).toEqual([
      "CALL_AUTOMATION_ATTEMPT_DUE",
      "WHATSAPP_SEND_REQUESTED"
    ]);
    expect(events.every(({ workspaceId }) => workspaceId === lead.workspaceId)).toBe(true);
  });

  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  }, 45000);

  it("schedules Day 1/5/9 follow-ups without repeating the human response on day zero", async () => {
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
    expect(
      await prisma.followUpSequence.findUniqueOrThrow({ where: { id: sequence.id } })
    ).toMatchObject({ workspaceId: lead.workspaceId });
    expect(sequence.cadenceDays).toEqual([1, 5, 9]);
    expect(sequence.cadenceMode).toBe("PRODUCTION_DAYS");
    expect(sequence.cadenceOffsetsMinutes).toEqual([1440, 7200, 12960]);
    expect(sequence.attempts).toHaveLength(3);
    expect(sequence.attempts.map((attempt) => attempt.scheduledAt)).toEqual([
      "2026-09-18T00:00:00.000Z",
      "2026-09-22T00:00:00.000Z",
      "2026-09-26T00:00:00.000Z"
    ]);
    expect(sequence.attempts.map((attempt) => attempt.kind)).toEqual([
      "FIRST_EMAIL",
      "FOLLOW_UP",
      "FOLLOW_UP"
    ]);
    await expect(
      prisma.domainEventOutbox.count({
        where: { aggregateType: "FollowUpAttempt", correlationId: sequence.id }
      })
    ).resolves.toBe(3);
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      nextAction: "Send first follow-up email",
      nextActionAt: new Date("2026-09-18T00:00:00.000Z")
    });
  }, 45000);

  it("selects the most specific persisted workspace policy and snapshots its cadence", async () => {
    const actor = await seedActor();
    const lead = await seedLead({
      serviceInterest: "Managed CRM",
      leadType: "Enterprise",
      country: "India",
      priority: "HIGH",
      campaign: "FY27 Launch"
    });
    const actorWithWorkspace = { ...actor, activeWorkspaceId: lead.workspaceId ?? undefined };
    await createFollowUpPolicy(actorWithWorkspace, {
      name: "R13 Policy broad",
      enabled: true,
      isDefault: false,
      selectionPriority: 100,
      service: "Managed CRM",
      cadenceDays: [0, 3, 8]
    });
    const specific = await createFollowUpPolicy(actorWithWorkspace, {
      name: "R13 Policy specific",
      enabled: true,
      isDefault: false,
      selectionPriority: 1,
      service: "managed crm",
      leadType: "enterprise",
      source: "R13-FOLLOWUP-TEST",
      country: "india",
      priority: "high",
      campaign: "fy27 launch",
      pipelineStageId: lead.stageId,
      cadenceDays: [0, 2, 6, 12]
    });

    const sequence = await startFollowUpSequence(
      actorWithWorkspace,
      lead.id,
      { idempotencyKey: `r13-policy-specific-${lead.id}` },
      {
        provider: new FollowUpTestProvider(),
        now: new Date("2026-09-17T00:00:00.000Z"),
        env: productionTimingEnv
      }
    );

    expect(sequence.policyId).toBe(specific.id);
    expect(sequence.policyName).toBe("R13 Policy specific");
    expect(sequence.cadenceDays).toEqual([2, 6, 12]);
    expect(sequence.cadenceOffsetsMinutes).toEqual([2880, 8640, 17280]);
    expect(sequence.attempts.map((attempt) => attempt.scheduledAt)).toEqual([
      "2026-09-19T00:00:00.000Z",
      "2026-09-23T00:00:00.000Z",
      "2026-09-29T00:00:00.000Z"
    ]);
  }, 45000);

  it("uses the persisted workspace default when no targeted policy matches", async () => {
    const actor = await seedActor();
    const lead = await seedLead();
    const actorWithWorkspace = { ...actor, activeWorkspaceId: lead.workspaceId ?? undefined };
    const [fallback] = await listFollowUpPolicies(actorWithWorkspace);
    if (!fallback) throw new Error("Expected persisted default policy");
    await updateFollowUpPolicy(actorWithWorkspace, fallback.id, { cadenceDays: [0, 4, 10] });
    await createFollowUpPolicy(actorWithWorkspace, {
      name: "R13 Policy non-match",
      enabled: true,
      isDefault: false,
      selectionPriority: 500,
      source: "another-source",
      cadenceDays: [0, 1]
    });

    const sequence = await startFollowUpSequence(
      actorWithWorkspace,
      lead.id,
      { idempotencyKey: `r13-policy-fallback-${lead.id}` },
      { provider: new FollowUpTestProvider(), env: productionTimingEnv }
    );

    expect(sequence.policyId).toBe(fallback.id);
    expect(sequence.cadenceDays).toEqual([4, 10]);
    expect(sequence.attempts).toHaveLength(2);
  }, 45000);

  it("keeps the selected cadence immutable when an idempotent start is retried", async () => {
    const actor = await seedActor();
    const lead = await seedLead({ campaign: "Immutable campaign" });
    const actorWithWorkspace = { ...actor, activeWorkspaceId: lead.workspaceId ?? undefined };
    const policy = await createFollowUpPolicy(actorWithWorkspace, {
      name: "R13 Policy immutable",
      enabled: true,
      isDefault: false,
      selectionPriority: 10,
      campaign: "Immutable campaign",
      cadenceDays: [0, 2, 7]
    });
    const key = `r13-policy-immutable-${lead.id}`;
    const first = await startFollowUpSequence(
      actorWithWorkspace,
      lead.id,
      { idempotencyKey: key },
      {
        provider: new FollowUpTestProvider(),
        env: productionTimingEnv
      }
    );
    await updateFollowUpPolicy(actorWithWorkspace, policy.id, { cadenceDays: [0, 9, 20] });
    const retried = await startFollowUpSequence(
      actorWithWorkspace,
      lead.id,
      { idempotencyKey: key },
      {
        provider: new FollowUpTestProvider(),
        env: productionTimingEnv
      }
    );

    expect(retried.id).toBe(first.id);
    expect(retried.cadenceDays).toEqual([2, 7]);
    expect(retried.attempts).toHaveLength(2);
    await expect(prisma.followUpSequence.count({ where: { idempotencyKey: key } })).resolves.toBe(
      1
    );
  }, 45000);

  it("enforces policy management roles and workspace isolation", async () => {
    const actor = await seedActor();
    const defaultWorkspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: "default" }
    });
    const otherWorkspace = await prisma.workspace.create({
      data: { name: "R13 Policy Isolation", slug: `r13-policy-isolation-${crypto.randomUUID()}` }
    });
    const foreignPolicy = await prisma.followUpPolicy.create({
      data: {
        workspaceId: otherWorkspace.id,
        name: "R13 Policy foreign",
        cadenceDays: [0, 2],
        enabled: true
      }
    });
    const actorWithWorkspace = { ...actor, activeWorkspaceId: defaultWorkspace.id };

    await expect(
      updateFollowUpPolicy(actorWithWorkspace, foreignPolicy.id, { cadenceDays: [0, 3] })
    ).rejects.toThrow("Follow-up policy not found");
    await expect(
      listFollowUpPolicies({ ...actorWithWorkspace, role: UserRole.SALES_REP })
    ).rejects.toThrow("Insufficient role permissions");
  });

  it("passes persisted intelligence and indexed lead-document evidence to follow-up drafting", async () => {
    const actor = await seedActor();
    const lead = await seedLead();
    await prisma.leadIntelligence.create({
      data: {
        workspaceId: lead.workspaceId ?? "",
        leadId: lead.id,
        communicationStyle: "Concise and practical",
        objections: ["Needs security approval"],
        commitments: ["Send architecture by Friday"],
        nextObjective: "Confirm technical review",
        preferredChannel: "EMAIL",
        contextSnapshot: {},
        evidence: []
      }
    });
    await prisma.leadDocument.create({
      data: {
        workspaceId: lead.workspaceId ?? "",
        leadId: lead.id,
        title: "Approved discovery evidence",
        kind: "AUDIT",
        sourceType: "CRM",
        status: "INDEXED",
        extractedText: "Security review is required.",
        indexedAt: new Date(),
        chunks: {
          create: [
            {
              workspaceId: lead.workspaceId ?? "",
              leadId: lead.id,
              position: 0,
              content: "Customer requires an ISO 27001 evidence pack."
            }
          ]
        }
      }
    });
    const provider = new RecordingFollowUpProvider();

    await startFollowUpSequence(
      { ...actor, activeWorkspaceId: lead.workspaceId ?? undefined },
      lead.id,
      { idempotencyKey: `r13-policy-context-${lead.id}` },
      { provider, env: productionTimingEnv }
    );

    expect(provider.contexts[0]).toMatchObject({
      intelligence: {
        communicationStyle: "Concise and practical",
        objections: ["Needs security approval"],
        commitments: ["Send architecture by Friday"],
        nextObjective: "Confirm technical review",
        preferredChannel: "EMAIL"
      },
      approvedLeadDocuments: [
        {
          title: "Approved discovery evidence",
          evidence: ["Customer requires an ISO 27001 evidence pack."]
        }
      ]
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
    expect(sequence?.attempts).toHaveLength(3);
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      nextAction: "Send first follow-up email",
      nextActionAt: new Date("2026-09-18T00:00:00.000Z")
    });
    await expect(
      prisma.domainEventOutbox.count({ where: { correlationId: sequence?.id } })
    ).resolves.toBe(3);
  }, 45000);

  it("reuses the active lead sequence when a second start uses a different key", async () => {
    const actor = await seedActor();
    const lead = await seedLead();
    const options = {
      provider: new FollowUpTestProvider(),
      now: new Date("2026-09-17T00:00:00.000Z"),
      env: productionTimingEnv
    };

    const first = await startFollowUpSequence(
      actor,
      lead.id,
      { idempotencyKey: `r13-active-first-${lead.id}` },
      options
    );
    const second = await startFollowUpSequence(
      actor,
      lead.id,
      { idempotencyKey: `r13-active-second-${lead.id}` },
      options
    );

    expect(second.id).toBe(first.id);
    await expect(
      prisma.followUpSequence.count({ where: { leadId: lead.id, status: "ACTIVE" } })
    ).resolves.toBe(1);
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

    const sequences = await listFollowUpSequencesForLead(
      { ...actor, activeWorkspaceId: lead.workspaceId ?? undefined },
      lead.id
    );

    expect(sequences).toHaveLength(1);
    expect(sequences[0]).toMatchObject({
      id: started.id,
      leadId: lead.id,
      status: "ACTIVE"
    });
    expect(sequences[0]?.attempts).toHaveLength(3);
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
      ["SENT", "2026-09-18T00:00:00.000Z"],
      ["SCHEDULED", "2026-09-17T01:01:00.000Z"],
      ["SCHEDULED", "2026-09-17T01:03:00.000Z"]
    ]);
    await expect(
      prisma.domainEventOutbox.findMany({
        where: { correlationId: sequence.id },
        orderBy: { nextAttemptAt: "asc" },
        select: { status: true, nextAttemptAt: true }
      })
    ).resolves.toEqual([
      { status: "PENDING", nextAttemptAt: new Date("2026-09-17T01:01:00.000Z") },
      { status: "PENDING", nextAttemptAt: new Date("2026-09-17T01:03:00.000Z") },
      { status: "PROCESSED", nextAttemptAt: new Date("2026-09-18T00:00:00.000Z") }
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
