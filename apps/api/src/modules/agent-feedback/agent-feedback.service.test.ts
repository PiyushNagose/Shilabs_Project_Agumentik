import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  createAgentCorrection,
  createProposalAgentCorrection,
  listAgentCorrections
} from "./agent-feedback.service.js";

const companyPrefix = "R25 Correction Company";

async function cleanup(): Promise<void> {
  const leads = await prisma.lead.findMany({
    where: { company: { name: { startsWith: companyPrefix } } },
    select: { id: true }
  });
  const leadIds = leads.map((lead) => lead.id);
  await prisma.agentCorrection.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.domainEventOutbox.deleteMany({ where: { eventType: "AGENT_CORRECTION_RECORDED" } });
  await prisma.auditEvent.deleteMany({ where: { action: "AGENT_CORRECTION_RECORDED" } });
  await prisma.activity.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.proposalGenerationRun.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.proposalStatusChange.deleteMany({ where: { proposal: { leadId: { in: leadIds } } } });
  await prisma.proposalVersion.deleteMany({ where: { proposal: { leadId: { in: leadIds } } } });
  await prisma.proposal.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { company: { name: { startsWith: companyPrefix } } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: companyPrefix } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "r25-correction-" } } });
}

async function createFixture() {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const user = await prisma.user.create({
    data: {
      email: `r25-correction-${crypto.randomUUID()}@example.local`,
      passwordHash: "not-a-real-password",
      firstName: "R25",
      lastName: "Reviewer",
      role: UserRole.SALES_MANAGER,
      status: UserStatus.ACTIVE
    }
  });
  const actor: AuthenticatedUser = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    activeWorkspaceId: workspace.id
  };
  const stage = await prisma.pipelineStage.upsert({
    where: { key: "R25_CORRECTION_NEW" },
    create: { key: "R25_CORRECTION_NEW", label: "R25 Correction New", order: 9250, probability: 10 },
    update: {}
  });
  const company = await prisma.company.create({
    data: { workspaceId: workspace.id, name: `${companyPrefix} ${crypto.randomUUID()}` }
  });
  const contact = await prisma.contact.create({
    data: { workspaceId: workspace.id, companyId: company.id, firstName: "R25", lastName: "Prospect" }
  });
  const lead = await prisma.lead.create({
    data: { workspaceId: workspace.id, companyId: company.id, contactId: contact.id, source: "R25_TEST", stageId: stage.id }
  });
  const proposal = await prisma.proposal.create({
    data: {
      workspaceId: workspace.id,
      leadId: lead.id,
      title: "R25 Generated Proposal",
      createdByUserId: user.id
    }
  });
  const version = await prisma.proposalVersion.create({
    data: {
      proposalId: proposal.id,
      version: 1,
      title: proposal.title,
      content: "Original AI proposal output",
      editSummary: "Generated",
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
      provider: "gemini",
      model: "gemini-flash-lite-latest",
      inputContext: { leadId: lead.id },
      aiOutput: { title: "Original AI proposal output" },
      missingFields: [],
      idempotencyKey: `r25-generation:${proposal.id}`
    }
  });
  return { actor, lead, proposal, run };
}

describe("R25 agent feedback corrections", () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("persists correction evidence with audit/domain event and does not mutate proposal output", async () => {
    const fixture = await createFixture();
    const correction = await createAgentCorrection(fixture.actor, {
      sourceEntityType: "PROPOSAL_GENERATION_RUN",
      sourceEntityId: fixture.run.id,
      correctionSummary: "Clarify custom pricing and remove unsupported guarantee.",
      correctedOutcome: { title: "Corrected proposal note", pricing: "custom" }
    });

    expect(correction.agentModule).toBe("proposal-generation:GENERAL");
    expect(correction.previousOutput).toMatchObject({ provider: "gemini" });
    await expect(
      prisma.proposal.findUnique({ where: { id: fixture.proposal.id }, include: { currentVersion: true } })
    ).resolves.toMatchObject({ currentVersion: { content: "Original AI proposal output" } });
    await expect(prisma.auditEvent.count({ where: { entityId: correction.id } })).resolves.toBe(1);
    await expect(
      prisma.domainEventOutbox.count({
        where: { aggregateType: "AgentCorrection", aggregateId: correction.id }
      })
    ).resolves.toBe(1);
  });

  it("creates proposal-linked corrections and keeps history through superseding", async () => {
    const fixture = await createFixture();
    const first = await createProposalAgentCorrection(fixture.actor, fixture.proposal.id, {
      correctionSummary: "First correction",
      correctedOutcome: { content: "First corrected outcome" }
    });
    const second = await createProposalAgentCorrection(fixture.actor, fixture.proposal.id, {
      correctionSummary: "Second correction",
      correctedOutcome: { content: "Second corrected outcome" },
      supersedesCorrectionId: first.id
    });
    const listed = await listAgentCorrections({ proposalId: fixture.proposal.id, limit: 10 });

    expect(second.version).toBe(2);
    expect(listed).toHaveLength(2);
    await expect(prisma.agentCorrection.findUnique({ where: { id: first.id } })).resolves.toMatchObject({
      status: "SUPERSEDED"
    });
  });
});
