import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import {
  approveProposal,
  createProposal,
  recordProposalSentAfterProviderConfirmation,
  submitProposalForApproval,
  updateProposalDraft
} from "./proposal.service.js";

const actorEmail = "r14-proposal-admin@example.local";
const repEmail = "r14-proposal-rep@example.local";
const source = "r14-proposal-test";

async function cleanup(): Promise<void> {
  await prisma.domainEventOutbox.deleteMany({
    where: { aggregateType: "Proposal" }
  });
  await prisma.proposal.updateMany({
    where: { lead: { source } },
    data: { currentVersionId: null, approvedVersionId: null }
  });
  await prisma.proposalStatusChange.deleteMany({ where: { proposal: { lead: { source } } } });
  await prisma.proposalVersion.deleteMany({ where: { proposal: { lead: { source } } } });
  await prisma.proposal.deleteMany({ where: { lead: { source } } });
  await prisma.outboundEmail.deleteMany({ where: { lead: { source } } });
  await prisma.activity.deleteMany({ where: { lead: { source } } });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { entityType: "Proposal" },
        { entityType: "DomainEventOutbox" },
        { entityType: "Deal" },
        { entityType: "Lead" }
      ]
    }
  });
  await prisma.deal.deleteMany({ where: { lead: { source } } });
  await prisma.lead.deleteMany({ where: { source } });
  await prisma.contact.deleteMany({ where: { source } });
  await prisma.company.deleteMany({ where: { name: { startsWith: "R14 Proposal" } } });
  await prisma.authSession.deleteMany({
    where: { user: { email: { in: [actorEmail, repEmail] } } }
  });
  await prisma.user.deleteMany({ where: { email: { in: [actorEmail, repEmail] } } });
}

async function seedUser(email: string, role: UserRole = UserRole.ADMIN) {
  return prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: "R14",
      lastName: role === UserRole.ADMIN ? "Admin" : "Rep",
      role,
      status: UserStatus.ACTIVE
    }
  });
}

async function seedLeadAndDeal() {
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
    data: { name: `R14 Proposal ${randomUUID()}` }
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "Proposal",
      lastName: "Lead",
      email: `r14-${randomUUID()}@example.local`,
      normalizedEmail: `r14-${randomUUID()}@example.local`,
      source
    }
  });
  const lead = await prisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source,
      requirement: "Needs proposal workflow",
      serviceInterest: "AI automation"
    }
  });
  const deal = await prisma.deal.create({
    data: {
      leadId: lead.id,
      stageId: stage.id,
      probability: stage.probability,
      status: "OPEN",
      currency: "INR"
    }
  });
  return { lead, deal, contact };
}

describe("R14 proposal workflow service", () => {
  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  }, 45000);

  it("creates proposal drafts with version and audit history", async () => {
    const actor = await seedUser(actorEmail);
    const { lead, deal } = await seedLeadAndDeal();

    const proposal = await createProposal(actor, {
      leadId: lead.id,
      dealId: deal.id,
      title: "Automation Proposal",
      serviceType: "AI Sales",
      content: "Initial proposal content",
      idempotencyKey: `r14-proposal-${lead.id}`
    });

    expect(proposal.status).toBe("DRAFT");
    expect(proposal.currentVersion?.version).toBe(1);
    expect(proposal.versions).toHaveLength(1);
    expect(proposal.statusChanges.map((change) => change.toStatus)).toEqual(["DRAFT"]);
    await expect(
      prisma.activity.count({ where: { leadId: lead.id, type: "PROPOSAL_CREATED" } })
    ).resolves.toBe(1);
  });

  it("stores edit history and records approval identity/version", async () => {
    const actor = await seedUser(actorEmail);
    const { lead, deal } = await seedLeadAndDeal();
    const draft = await createProposal(actor, {
      leadId: lead.id,
      dealId: deal.id,
      title: "Draft Proposal",
      content: "Version one"
    });

    const edited = await updateProposalDraft(actor, draft.id, {
      title: "Edited Proposal",
      content: "Version two",
      editSummary: "Human edit"
    });
    expect(edited.versions.map((version) => version.version)).toEqual([2, 1]);

    const waiting = await submitProposalForApproval(actor, draft.id, { reason: "Ready" });
    expect(waiting.status).toBe("WAITING_APPROVAL");

    const approved = await approveProposal(actor, draft.id, { reason: "Approved by manager" });
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedByUserId).toBe(actor.id);
    expect(approved.approvedVersionId).toBe(approved.currentVersionId);
    expect(approved.approvedAt).toEqual(expect.any(String));
    await expect(
      prisma.domainEventOutbox.count({
        where: { eventType: "PROPOSAL_APPROVED", aggregateId: draft.id }
      })
    ).resolves.toBe(1);
  });

  it("blocks sent state until a proposal is approved", async () => {
    const actor = await seedUser(actorEmail);
    const { lead, deal, contact } = await seedLeadAndDeal();
    const proposal = await createProposal(actor, {
      leadId: lead.id,
      dealId: deal.id,
      title: "Not Approved",
      content: "Draft only"
    });
    const outbound = await prisma.outboundEmail.create({
      data: {
        leadId: lead.id,
        contactId: contact.id,
        toEmail: contact.email ?? "r14@example.local",
        normalizedToEmail: contact.normalizedEmail ?? "r14@example.local",
        fromEmail: "sales@example.local",
        subject: "Proposal",
        textBody: "Proposal body",
        provider: "AWS_SES",
        providerMessageId: `r14-${randomUUID()}`,
        idempotencyKey: `r14-outbound-${randomUUID()}`,
        status: "SENT",
        sentAt: new Date()
      }
    });

    await expect(
      recordProposalSentAfterProviderConfirmation(actor, proposal.id, {
        outboundEmailId: outbound.id
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
  });

  it("records sent only after approval and provider-confirmed outbound email", async () => {
    const actor = await seedUser(actorEmail);
    const { lead, deal, contact } = await seedLeadAndDeal();
    const proposal = await createProposal(actor, {
      leadId: lead.id,
      dealId: deal.id,
      title: "Approved Proposal",
      content: "Proposal content"
    });
    await submitProposalForApproval(actor, proposal.id, {});
    await approveProposal(actor, proposal.id, {});
    const outbound = await prisma.outboundEmail.create({
      data: {
        leadId: lead.id,
        contactId: contact.id,
        toEmail: contact.email ?? "r14@example.local",
        normalizedToEmail: contact.normalizedEmail ?? "r14@example.local",
        fromEmail: "sales@example.local",
        subject: "Proposal",
        textBody: "Proposal body",
        provider: "AWS_SES",
        providerMessageId: `r14-${randomUUID()}`,
        idempotencyKey: `r14-outbound-${randomUUID()}`,
        status: "SENT",
        sentAt: new Date("2026-09-17T12:00:00.000Z")
      }
    });

    const sent = await recordProposalSentAfterProviderConfirmation(actor, proposal.id, {
      outboundEmailId: outbound.id
    });

    expect(sent.status).toBe("SENT");
    expect(sent.sentOutboundEmailId).toBe(outbound.id);
    expect(sent.sentAt).toBe("2026-09-17T12:00:00.000Z");
    await expect(
      prisma.domainEventOutbox.count({
        where: { eventType: "PROPOSAL_SENT", aggregateId: proposal.id }
      })
    ).resolves.toBe(1);
  });
});
