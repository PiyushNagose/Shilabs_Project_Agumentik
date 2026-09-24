import { randomUUID } from "node:crypto";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import type { AIProvider } from "../ai/ai.provider.js";
import { hashPassword } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  getQualification,
  recalculateQualification,
  updateQualification
} from "./qualification.service.js";

const companyNamePrefix = "M10 Qualification Company";
const adminEmail = "qualification-admin@example.local";
const newStage = {
  key: "NEW",
  label: "New",
  order: 10,
  probability: 5,
  isClosed: false,
  isWon: false,
  isLost: false
};

async function seedStages(): Promise<void> {
  await prisma.pipelineStage.upsert({
    where: { key: newStage.key },
    create: newStage,
    update: newStage
  });
}

async function cleanup(): Promise<void> {
  await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
  await prisma.leadQualificationEvidence.deleteMany({
    where: { qualification: { lead: { company: { name: { startsWith: companyNamePrefix } } } } }
  });
  await prisma.leadQualification.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.message.deleteMany({
    where: { conversation: { lead: { company: { name: { startsWith: companyNamePrefix } } } } }
  });
  await prisma.conversation.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.activity.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.auditEvent.deleteMany({
    where: { entityType: { in: ["LeadQualification", "Lead"] } }
  });
  await prisma.deal.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.lead.deleteMany({ where: { company: { name: { startsWith: companyNamePrefix } } } });
  await prisma.contact.deleteMany({
    where: { company: { name: { startsWith: companyNamePrefix } } }
  });
  await prisma.company.deleteMany({ where: { name: { startsWith: companyNamePrefix } } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

async function createLeadWithMessage(body = "We need a real estate website this month."): Promise<{
  actor: AuthenticatedUser;
  leadId: string;
  messageId: string;
}> {
  const user = await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: "Qualification",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
  const uniqueSlug = `m10-${randomUUID()}`;
  const company = await prisma.company.create({
    data: {
      name: `${companyNamePrefix} ${uniqueSlug}`,
      website: `https://${uniqueSlug}.example`,
      normalizedWebsite: `${uniqueSlug}.example`
    }
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "Qualified",
      lastName: "Prospect",
      email: `${uniqueSlug}@example.local`,
      normalizedEmail: `${uniqueSlug}@example.local`
    }
  });
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
  const lead = await prisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      ownerId: user.id,
      stageId: stage.id,
      source: "website",
      requirement: "Needs a website"
    }
  });
  const conversation = await prisma.conversation.create({
    data: { leadId: lead.id, channel: "WEBSITE", mode: "AUTO" }
  });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      senderType: "PROSPECT",
      body
    }
  });
  return { actor: user, leadId: lead.id, messageId: message.id };
}

function provider(output: Awaited<ReturnType<AIProvider["extractQualification"]>>): AIProvider {
  return {
    generateSalesReply: () =>
      Promise.resolve({
        body: "test",
        requiresHumanReview: false,
        reason: null
      }),
    extractQualification: () => Promise.resolve(output),
    summarizeLead: () =>
      Promise.resolve({
        summary: "test",
        buyingSignals: [],
        objections: [],
        risks: [],
        suggestedNextAction: null
      }),
    generateFollowUp: () =>
      Promise.resolve({
        body: "test",
        requiresHumanReview: false,
        reason: null
      }),
    generateProposalDraft: () =>
      Promise.resolve({
        title: "Test proposal",
        serviceType: "AI Sales",
        content: "Proposal content",
        usedKnowledgeIds: [],
        evidence: [],
        requiresHumanReview: true,
        missingInformation: []
      }),
    understandReply: () =>
      Promise.resolve({
        intent: "INTERESTED",
        confidence: 0.9,
        summary: "test",
        draftResponse: "test",
        requiresHumanReview: true,
        recommendedAction: "DRAFT_RESPONSE",
        evidence: [],
        usedKnowledgeIds: []
      }),
    generateBriefing: () =>
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
      }),
    createEmbedding: () => Promise.resolve([0.1])
  };
}

describe("M10 qualification service", () => {
  beforeEach(async () => {
    await seedStages();
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("returns an empty qualification shape without mutating on read", async () => {
    const { leadId } = await createLeadWithMessage();
    const qualification = await getQualification(leadId);

    expect(qualification.id).toBeNull();
    expect(qualification.need).toBeNull();
    expect(await prisma.leadQualification.count({ where: { leadId } })).toBe(0);
  }, 45000);

  it("saves valid AI extraction with evidence and audit history", async () => {
    const { leadId, messageId } = await createLeadWithMessage();
    const qualification = await recalculateQualification(
      leadId,
      provider({
        need: "real estate website",
        requirement: "real estate website this month",
        budget: null,
        budgetBand: null,
        authority: null,
        timeline: "this month",
        businessFit: "web development fit",
        decisionMakerIdentified: null,
        urgency: "urgent",
        evidence: [{ messageId, quote: "real estate website this month" }]
      })
    );

    expect(qualification.need).toBe("real estate website");
    expect(qualification.budget).toBeNull();
    expect(qualification.evidence).toHaveLength(1);
    await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: "LeadQualification",
        entityId: qualification.id ?? "",
        action: "QUALIFICATION_UPDATED"
      }
    });
    const activity = await prisma.activity.findFirstOrThrow({
      where: { leadId, type: "QUALIFICATION_UPDATED" }
    });
    expect(activity.actorUserId).toBeNull();
  }, 45000);

  it("rejects malformed AI extraction before saving", async () => {
    const { leadId } = await createLeadWithMessage();
    const badProvider = {
      ...provider({
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
      }),
      extractQualification: () =>
        Promise.resolve({ need: "website", score: 100 } as unknown as Awaited<
          ReturnType<AIProvider["extractQualification"]>
        >)
    } satisfies AIProvider;

    await expect(recalculateQualification(leadId, badProvider)).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    });
    expect(await prisma.leadQualification.count({ where: { leadId } })).toBe(0);
  }, 45000);

  it("rejects hallucinated evidence that does not quote a saved message", async () => {
    const { leadId, messageId } = await createLeadWithMessage();
    await expect(
      recalculateQualification(
        leadId,
        provider({
          need: "website",
          requirement: null,
          budget: null,
          budgetBand: null,
          authority: null,
          timeline: null,
          businessFit: null,
          decisionMakerIdentified: null,
          urgency: null,
          evidence: [{ messageId, quote: "budget is 50000" }]
        })
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  }, 45000);

  it("allows human correction and explicit null unknowns", async () => {
    const { actor, leadId, messageId } = await createLeadWithMessage(
      "I am the owner and need a website."
    );
    const qualification = await updateQualification(actor, leadId, {
      authority: "owner",
      budget: null,
      decisionMakerIdentified: true,
      evidence: [{ messageId, quote: "I am the owner" }]
    });

    expect(qualification.authority).toBe("owner");
    expect(qualification.budget).toBeNull();
    expect(qualification.decisionMakerIdentified).toBe(true);
    expect(qualification.evidence[0]?.quote).toBe("I am the owner");
  }, 45000);
});
