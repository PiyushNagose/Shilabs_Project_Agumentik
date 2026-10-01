import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AgentCorrectionDto, AuthResponse } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const password = "CorrectHorse123!";
const email = "r25-agent-feedback-api-admin@example.local";
const companyPrefix = "R25 Agent Feedback API";

process.env.JWT_SECRET = "r25-agent-feedback-api-secret-32-chars";

async function cleanup(): Promise<void> {
  const leads = await prisma.lead.findMany({
    where: { company: { name: { startsWith: companyPrefix } } },
    select: { id: true }
  });
  const leadIds = leads.map((lead) => lead.id);
  await prisma.agentCorrection.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.proposalGenerationRun.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.proposal.updateMany({
    where: { leadId: { in: leadIds } },
    data: { currentVersionId: null, approvedVersionId: null }
  });
  await prisma.proposalStatusChange.deleteMany({ where: { proposal: { leadId: { in: leadIds } } } });
  await prisma.proposalVersion.deleteMany({ where: { proposal: { leadId: { in: leadIds } } } });
  await prisma.proposal.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { company: { name: { startsWith: companyPrefix } } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: companyPrefix } } });
  await prisma.authSession.deleteMany({ where: { user: { email } } });
  await prisma.user.deleteMany({ where: { email } });
}

async function login(): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.body as AuthResponse).accessToken;
}

async function seedProposalWithCorrection(): Promise<{ proposalId: string }> {
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: "R25",
      lastName: "API",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
  const stage = await prisma.pipelineStage.upsert({
    where: { key: "R25_AGENT_FEEDBACK_API" },
    create: {
      key: "R25_AGENT_FEEDBACK_API",
      label: "R25 Agent Feedback API",
      order: 9251,
      probability: 10
    },
    update: {}
  });
  const company = await prisma.company.create({
    data: { name: `${companyPrefix} ${crypto.randomUUID()}` }
  });
  const contact = await prisma.contact.create({
    data: { companyId: company.id, firstName: "R25", lastName: "Prospect" }
  });
  const lead = await prisma.lead.create({
    data: { companyId: company.id, contactId: contact.id, source: "R25_API_TEST", stageId: stage.id }
  });
  const proposal = await prisma.proposal.create({
    data: {
      leadId: lead.id,
      title: "R25 API Proposal",
      createdByUserId: user.id
    }
  });
  const version = await prisma.proposalVersion.create({
    data: {
      proposalId: proposal.id,
      version: 1,
      title: proposal.title,
      content: "Original proposal",
      createdByUserId: user.id
    }
  });
  await prisma.proposal.update({
    where: { id: proposal.id },
    data: { currentVersionId: version.id }
  });
  const run = await prisma.proposalGenerationRun.create({
    data: {
      leadId: lead.id,
      proposalId: proposal.id,
      actorUserId: user.id,
      kind: "GENERAL",
      status: "COMPLETED",
      provider: "test",
      model: "test",
      inputContext: { leadId: lead.id },
      aiOutput: { title: proposal.title },
      missingFields: [],
      idempotencyKey: `r25-agent-feedback-api:${proposal.id}`
    }
  });
  await prisma.agentCorrection.create({
    data: {
      agentModule: "proposal-generation:GENERAL",
      sourceEntityType: "PROPOSAL_GENERATION_RUN",
      sourceEntityId: run.id,
      leadId: lead.id,
      proposalId: proposal.id,
      proposalGenerationRunId: run.id,
      previousOutput: { title: proposal.title },
      correctedOutcome: { title: "Corrected proposal" },
      correctionSummary: "Clarify scope",
      version: 1,
      correctedByUserId: user.id
    }
  });

  return { proposalId: proposal.id };
}

describe("R25 agent feedback API", () => {
  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("uses validated query params when listing proposal corrections", async () => {
    const { proposalId } = await seedProposalWithCorrection();
    const token = await login();

    const response = await request(app)
      .get(`/api/agent-feedback/corrections?proposalId=${proposalId}&limit=10`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const corrections = response.body as AgentCorrectionDto[];
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({
      proposalId,
      correctionSummary: "Clarify scope"
    });
  });
});
