import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import type { AIProvider, ProposalDraftResult } from "../ai/ai.provider.js";
import { hashPassword } from "../auth/auth.service.js";
import type { SEODataProvider } from "../integrations/semrush/seo-data.provider.js";
import { generateProposal } from "./proposal-generation.service.js";

const actorEmail = "r15-proposal-admin@example.local";
const source = "r15-proposal-test";

class ProposalTestProvider implements AIProvider {
  public constructor(private readonly output: ProposalDraftResult) {}
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
  public generateFollowUp: AIProvider["generateFollowUp"] = () =>
    Promise.resolve({ body: "test", requiresHumanReview: true, reason: null });
  public generateProposalDraft: AIProvider["generateProposalDraft"] = vi.fn(() =>
    Promise.resolve(this.output)
  );
  public understandReply: AIProvider["understandReply"] = () =>
    Promise.resolve({
      intent: "PROPOSAL_REQUEST",
      confidence: 0.9,
      summary: "test",
      draftResponse: null,
      requiresHumanReview: true,
      recommendedAction: "PROPOSAL_REVIEW",
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

class SeoTestProvider implements SEODataProvider {
  public analyzeDomain = vi.fn(() =>
    Promise.resolve({
      provider: "SEMRUSH" as const,
      targetUrl: "https://client.example",
      database: "us",
      organicKeywords: 120,
      organicTraffic: 3500,
      backlinks: null,
      raw: [{ Or: "120", Ot: "3500" }]
    })
  );
}

async function cleanup(): Promise<void> {
  await prisma.domainEventOutbox.deleteMany({
    where: { eventType: { in: ["PROPOSAL_GENERATED", "PROPOSAL_APPROVED", "PROPOSAL_SENT"] } }
  });
  await prisma.proposalGenerationRun.deleteMany({ where: { lead: { source } } });
  await prisma.proposal.updateMany({
    where: { lead: { source } },
    data: { currentVersionId: null, approvedVersionId: null }
  });
  await prisma.proposalStatusChange.deleteMany({ where: { proposal: { lead: { source } } } });
  await prisma.proposalVersion.deleteMany({ where: { proposal: { lead: { source } } } });
  await prisma.proposal.deleteMany({ where: { lead: { source } } });
  await prisma.activity.deleteMany({ where: { lead: { source } } });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { entityType: "Proposal" },
        { entityType: "ProposalGenerationRun" },
        { entityType: "KnowledgeBaseEntry" }
      ]
    }
  });
  await prisma.deal.deleteMany({ where: { lead: { source } } });
  await prisma.lead.deleteMany({ where: { source } });
  await prisma.contact.deleteMany({ where: { source } });
  await prisma.company.deleteMany({ where: { name: { startsWith: "R15 Proposal" } } });
  await prisma.knowledgeBaseEntry.updateMany({
    where: { key: { startsWith: "r15-" } },
    data: { activeVersionId: null }
  });
  await prisma.knowledgeBaseVersion.deleteMany({
    where: { entry: { key: { startsWith: "r15-" } } }
  });
  await prisma.knowledgeBaseEntry.deleteMany({ where: { key: { startsWith: "r15-" } } });
  await prisma.integrationAccount.deleteMany({ where: { provider: "SEMRUSH" } });
  await prisma.authSession.deleteMany({ where: { user: { email: actorEmail } } });
  await prisma.user.deleteMany({ where: { email: actorEmail } });
}

async function seedActor() {
  return prisma.user.create({
    data: {
      email: actorEmail,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: "R15",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
}

async function seedLeadAndDeal() {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const stage = await prisma.pipelineStage.upsert({
    where: { key: "PROPOSAL" },
    create: {
      key: "PROPOSAL",
      label: "Proposal",
      order: 60,
      probability: 70,
      isClosed: false,
      isWon: false,
      isLost: false
    },
    update: {
      label: "Proposal",
      order: 60,
      probability: 70,
      isClosed: false,
      isWon: false,
      isLost: false
    }
  });
  const company = await prisma.company.create({
    data: {
      workspaceId: workspace.id,
      name: `R15 Proposal ${randomUUID()}`,
      website: "https://client.example"
    }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "Proposal",
      lastName: "Lead",
      email: `r15-${randomUUID()}@example.local`,
      normalizedEmail: `r15-${randomUUID()}@example.local`,
      source
    }
  });
  const lead = await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source,
      requirement: "Needs an AI sales proposal",
      serviceInterest: "AI automation"
    }
  });
  const deal = await prisma.deal.create({
    data: {
      workspaceId: workspace.id,
      leadId: lead.id,
      stageId: stage.id,
      probability: stage.probability,
      status: "OPEN",
      currency: "INR"
    }
  });
  return { lead, deal };
}

async function seedApprovedKnowledge() {
  const entry = await prisma.knowledgeBaseEntry.create({
    data: {
      key: `r15-${randomUUID()}`,
      title: "R15 Approved Proposal Knowledge",
      category: "PROPOSAL",
      status: "APPROVED"
    }
  });
  const version = await prisma.knowledgeBaseVersion.create({
    data: {
      entryId: entry.id,
      version: 1,
      content: "Shilabs provides AI sales automation implementation services.",
      sourceTitle: "Approved services",
      sourceType: "INTERNAL",
      approvedAt: new Date()
    }
  });
  await prisma.knowledgeBaseEntry.update({
    where: { id: entry.id },
    data: { activeVersionId: version.id }
  });
  return version;
}

function proposalOutput(sourceIds: string[]): ProposalDraftResult {
  return {
    title: "AI Sales Automation Proposal",
    serviceType: "AI Sales Automation",
    content: "A grounded proposal for the lead. Human approval is required before sending.",
    usedKnowledgeIds: sourceIds,
    evidence: sourceIds.map((sourceId) => ({ sourceId, quote: "approved evidence" })),
    requiresHumanReview: true,
    missingInformation: []
  };
}

describe("R15 proposal generation service", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  }, 45000);

  it("generates a general proposal draft and moves it to waiting approval", async () => {
    const actor = await seedActor();
    const { lead, deal } = await seedLeadAndDeal();
    const knowledge = await seedApprovedKnowledge();

    const result = await generateProposal(
      actor,
      {
        leadId: lead.id,
        dealId: deal.id,
        kind: "GENERAL",
        idempotencyKey: `r15-general-${lead.id}`
      },
      {
        env: {
          AI_PROVIDER: "gemini",
          GEMINI_API_KEY: "test",
          GEMINI_MODEL: "gemini-test",
          GEMINI_EMBEDDING_MODEL: "embedding-test"
        },
        aiProvider: new ProposalTestProvider(proposalOutput([knowledge.id]))
      }
    );

    expect(result.run.status).toBe("COMPLETED");
    expect(result.proposal?.status).toBe("WAITING_APPROVAL");
    expect(result.proposal?.versions[0]?.content).toContain("Human approval");
    await expect(
      prisma.domainEventOutbox.count({
        where: { eventType: "PROPOSAL_GENERATED", aggregateId: result.proposal?.id }
      })
    ).resolves.toBe(1);
  });

  it("persists missing web/design requirements instead of generating a final proposal", async () => {
    const actor = await seedActor();
    const { lead } = await seedLeadAndDeal();

    const result = await generateProposal(actor, {
      leadId: lead.id,
      kind: "WEB_DESIGN",
      brandName: "Client Brand",
      idempotencyKey: `r15-web-missing-${lead.id}`
    });

    expect(result.run.status).toBe("NEEDS_INPUT");
    expect(result.run.proposalId).toBeNull();
    expect(result.run.missingFields).toEqual(["designGoals", "preferredStyle", "requiredPages"]);
  });

  it("records truthful SEMrush not-configured failure for SEO proposals", async () => {
    const actor = await seedActor();
    const { lead } = await seedLeadAndDeal();
    await seedApprovedKnowledge();

    const result = await generateProposal(
      actor,
      {
        leadId: lead.id,
        kind: "SEO",
        targetWebsite: "https://client.example",
        idempotencyKey: `r15-seo-not-configured-${lead.id}`
      },
      {
        env: {
          AI_PROVIDER: "gemini",
          GEMINI_API_KEY: "test",
          GEMINI_MODEL: "gemini-test",
          GEMINI_EMBEDDING_MODEL: "embedding-test",
          SEMRUSH_API_KEY: ""
        }
      }
    );

    expect(result.run.status).toBe("FAILED");
    expect(result.run.failureMessage).toContain("SEMrush is not configured");
    await expect(
      prisma.integrationAccount.findFirst({
        where: { provider: "SEMRUSH", key: "default" }
      })
    ).resolves.toMatchObject({ status: "NOT_CONFIGURED" });
  });

  it("uses SEO provider evidence for SEO proposal generation", async () => {
    const actor = await seedActor();
    const { lead } = await seedLeadAndDeal();
    await seedApprovedKnowledge();
    const seoProvider = new SeoTestProvider();

    const result = await generateProposal(
      actor,
      {
        leadId: lead.id,
        kind: "SEO",
        targetWebsite: "https://client.example",
        idempotencyKey: `r15-seo-success-${lead.id}`
      },
      {
        env: {
          AI_PROVIDER: "gemini",
          GEMINI_API_KEY: "test",
          GEMINI_MODEL: "gemini-test",
          GEMINI_EMBEDDING_MODEL: "embedding-test",
          SEMRUSH_API_KEY: "test-key"
        },
        seoProvider,
        aiProvider: new ProposalTestProvider(proposalOutput(["semrush:https://client.example"]))
      }
    );

    expect(result.run.status).toBe("COMPLETED");
    expect(result.proposal?.status).toBe("WAITING_APPROVAL");
    expect(seoProvider.analyzeDomain).toHaveBeenCalledOnce();
  });
});
