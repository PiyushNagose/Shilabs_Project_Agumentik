import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import type { EmailProvider, EmailSendInput } from "../email/email.provider.js";
import { approveProposal, createProposal, submitProposalForApproval } from "./proposal.service.js";
import { sendApprovedProposal } from "./proposal-send.service.js";

const actorEmail = "r16-proposal-admin@example.local";
const source = "r16-proposal-test";
const configuredSesTestEnv = {
  ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION: "true",
  AWS_SES_REGION: "us-east-1",
  AWS_SES_FROM_EMAIL: "sales@example.com",
  AWS_SES_WEBHOOK_SECRET: "secret",
  AWS_SES_ACCESS_KEY_ID: "key",
  AWS_SES_SECRET_ACCESS_KEY: "secret"
};

class TestEmailProvider implements EmailProvider {
  public sendEmailMock = vi.fn((input: EmailSendInput) =>
    Promise.resolve({
      provider: "AWS_SES" as const,
      providerMessageId: `ses-${input.idempotencyKey}`
    })
  );
  public verifyConnection: EmailProvider["verifyConnection"] = () =>
    Promise.resolve({ provider: "AWS_SES", sendingEnabled: true });
  public sendEmail(input: EmailSendInput) {
    return this.sendEmailMock(input);
  }
}

function zohoSuccessTransport(): typeof fetch {
  return (url: string | URL | Request) => {
    const target = url instanceof Request ? url.url : String(url);
    if (target.includes("/oauth/v2/token")) {
      return Promise.resolve(
        Response.json({
          access_token: "zoho-token",
          expires_in: 3600,
          scope: "ZohoBigin.modules.ALL"
        })
      );
    }
    return Promise.resolve(
      Response.json({
        data: [{ status: "success", details: { id: `note-${randomUUID()}` } }]
      })
    );
  };
}

async function cleanup(): Promise<void> {
  const testProposalIds = (
    await prisma.proposal.findMany({
      where: { lead: { source } },
      select: { id: true }
    })
  ).map((proposal) => proposal.id);

  await prisma.externalRecordMapping.deleteMany({
    where: {
      OR: [
        { localEntityId: { startsWith: "r16-" } },
        { externalRecordId: { startsWith: "r16-" } },
        { externalRecordId: { startsWith: "note-" } }
      ]
    }
  });
  if (testProposalIds.length > 0) {
    await prisma.domainEventOutbox.deleteMany({
      where: {
        eventType: { in: ["PROPOSAL_APPROVED", "PROPOSAL_SENT"] },
        aggregateId: { in: testProposalIds }
      }
    });
  }
  await prisma.proposal.updateMany({
    where: { lead: { source } },
    data: { currentVersionId: null, approvedVersionId: null, sentOutboundEmailId: null }
  });
  await prisma.humanTakeover.deleteMany({ where: { lead: { source } } });
  await prisma.proposalStatusChange.deleteMany({ where: { proposal: { lead: { source } } } });
  await prisma.proposalVersion.deleteMany({ where: { proposal: { lead: { source } } } });
  await prisma.proposal.deleteMany({ where: { lead: { source } } });
  await prisma.outboundEmail.deleteMany({ where: { lead: { source } } });
  await prisma.conversation.deleteMany({ where: { lead: { source } } });
  await prisma.activity.deleteMany({ where: { lead: { source } } });
  await prisma.auditEvent.deleteMany({
    where: { entityType: { in: ["Proposal", "OutboundEmail", "Activity", "Conversation", "Lead"] } }
  });
  await prisma.deal.deleteMany({ where: { lead: { source } } });
  await prisma.lead.deleteMany({ where: { source } });
  await prisma.contact.deleteMany({ where: { source } });
  await prisma.company.deleteMany({ where: { name: { startsWith: "R16 Proposal" } } });
  await prisma.integrationAccount.deleteMany({ where: { provider: "ZOHO_BIGIN" } });
  await prisma.authSession.deleteMany({ where: { user: { email: actorEmail } } });
  await prisma.user.deleteMany({ where: { email: actorEmail } });
}

async function seedActor() {
  return prisma.user.create({
    data: {
      email: actorEmail,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: "R16",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
}

async function seedApprovedProposal() {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const seededActor = await seedActor();
  const actor = { ...seededActor, activeWorkspaceId: workspace.id };
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
    update: {}
  });
  const company = await prisma.company.create({
    data: { workspaceId: workspace.id, name: `R16 Proposal ${randomUUID()}`, website: "https://client.example" }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "Proposal",
      lastName: "Buyer",
      email: `r16-${randomUUID()}@example.local`,
      normalizedEmail: `r16-${randomUUID()}@example.local`,
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
      requirement: "Send approved proposal",
      serviceInterest: "AI automation"
    }
  });
  const deal = await prisma.deal.create({
    data: { workspaceId: workspace.id, leadId: lead.id, stageId: stage.id, probability: 70, status: "OPEN" }
  });
  const proposal = await createProposal(actor, {
    leadId: lead.id,
    dealId: deal.id,
    title: "Approved R16 Proposal",
    content: "Approved proposal body",
    idempotencyKey: `r16-proposal-${lead.id}`
  });
  await submitProposalForApproval(actor, proposal.id, {});
  const approved = await approveProposal(actor, proposal.id, {});
  return { actor, lead, approved };
}

async function mapLeadToZoho(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (!lead.workspaceId) throw new Error("Test lead workspace is missing");
  const account = await prisma.integrationAccount.upsert({
    where: {
      workspaceId_provider_key: {
        workspaceId: lead.workspaceId,
        provider: "ZOHO_BIGIN",
        key: "default"
      }
    },
    create: {
      workspaceId: lead.workspaceId,
      provider: "ZOHO_BIGIN",
      key: "default",
      displayName: "Zoho Bigin",
      status: "CONFIGURED",
      secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET"
    },
    update: { status: "CONFIGURED" }
  });
  await prisma.externalRecordMapping.create({
    data: {
      workspaceId: lead.workspaceId,
      integrationAccountId: account.id,
      provider: "ZOHO_BIGIN",
      entityType: "LEAD",
      localEntityId: leadId,
      externalRecordId: `r16-zoho-lead-${leadId}`,
      syncStatus: "SYNCED",
      syncDirection: "BIDIRECTIONAL"
    }
  });
}

describe("R16 proposal send service", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  }, 45000);

  it("sends an approved proposal and syncs the sent activity to Zoho", async () => {
    const { actor, lead, approved } = await seedApprovedProposal();
    await mapLeadToZoho(lead.id);
    const provider = new TestEmailProvider();

    const result = await sendApprovedProposal(
      actor,
      approved.id,
      { idempotencyKey: `r16-send-${approved.id}` },
      {
        emailProvider: provider,
        zohoTransport: zohoSuccessTransport(),
        env: {
          ...configuredSesTestEnv,
          ZOHO_BIGIN_CLIENT_ID: "client",
          ZOHO_BIGIN_CLIENT_SECRET: "secret",
          ZOHO_BIGIN_REFRESH_TOKEN: "refresh"
        }
      }
    );

    expect(result.outboundEmail.status).toBe("SENT");
    expect(result.proposal.status).toBe("SENT");
    expect(result.proposal.zohoTimelineSyncStatus).toBe("SYNCED");
    expect(result.zohoTimeline?.status).toBe("SYNCED");
    expect(provider.sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("resumes automation and waits for customer response after a proposal is sent", async () => {
    const { actor, lead, approved } = await seedApprovedProposal();
    await prisma.lead.update({
      where: { id: lead.id },
      data: { nextAction: "Review AI-generated proposal" }
    });
    const conversation = await prisma.conversation.create({
      data: { leadId: lead.id, channel: "EMAIL", mode: "HUMAN" }
    });
    const provider = new TestEmailProvider();

    await sendApprovedProposal(
      actor,
      approved.id,
      { idempotencyKey: `r16-send-resume-${approved.id}` },
      { emailProvider: provider, env: configuredSesTestEnv }
    );

    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      nextAction: "Await customer response",
      nextActionAt: null
    });
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })
    ).resolves.toMatchObject({ mode: "AUTO" });
    await expect(
      prisma.auditEvent.findFirstOrThrow({
        where: {
          entityType: "Conversation",
          entityId: conversation.id,
          action: "AI_AUTOMATION_RESUMED_AFTER_PROPOSAL_SENT"
        }
      })
    ).resolves.toMatchObject({
      actorType: "USER",
      actorId: actor.id
    });
  });

  it("does not mark proposal sent when the EmailProvider does not confirm send", async () => {
    const { actor, approved } = await seedApprovedProposal();

    const result = await sendApprovedProposal(
      actor,
      approved.id,
      { idempotencyKey: `r16-send-failed-${approved.id}` },
      { env: {} }
    );

    expect(result.outboundEmail.status).toBe("FAILED");
    expect(result.proposal.status).toBe("APPROVED");
    expect(result.zohoTimeline).toBeNull();
  });

  it("persists missing Zoho config without changing confirmed proposal send", async () => {
    const { actor, approved } = await seedApprovedProposal();
    const provider = new TestEmailProvider();

    const result = await sendApprovedProposal(
      actor,
      approved.id,
      { idempotencyKey: `r16-send-no-zoho-${approved.id}` },
      {
        emailProvider: provider,
        env: configuredSesTestEnv
      }
    );

    expect(result.outboundEmail.status).toBe("SENT");
    expect(result.proposal.status).toBe("SENT");
    expect(result.proposal.zohoTimelineSyncStatus).toBe("NOT_CONFIGURED");
    expect(result.zohoTimeline?.status).toBe("NOT_CONFIGURED");
  });

  it("retries Zoho only after an already confirmed proposal email send", async () => {
    const { actor, lead, approved } = await seedApprovedProposal();
    const provider = new TestEmailProvider();
    const baseEnv = configuredSesTestEnv;

    await sendApprovedProposal(
      actor,
      approved.id,
      { idempotencyKey: `r16-send-retry-${approved.id}` },
      { emailProvider: provider, env: baseEnv }
    );
    await mapLeadToZoho(lead.id);
    const retry = await sendApprovedProposal(
      actor,
      approved.id,
      { idempotencyKey: `r16-send-retry-${approved.id}` },
      {
        emailProvider: provider,
        zohoTransport: zohoSuccessTransport(),
        env: {
          ...baseEnv,
          ZOHO_BIGIN_CLIENT_ID: "client",
          ZOHO_BIGIN_CLIENT_SECRET: "secret",
          ZOHO_BIGIN_REFRESH_TOKEN: "refresh"
        }
      }
    );

    expect(provider.sendEmailMock).toHaveBeenCalledTimes(1);
    expect(retry.proposal.zohoTimelineSyncStatus).toBe("SYNCED");
    expect(retry.zohoTimeline?.status).toBe("SYNCED");
  }, 120000);
});
