import type { ProposalSendResultDto, ZohoTimelineAppendDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { sendOutboundEmail } from "../email/email.service.js";
import type { EmailProvider } from "../email/email.provider.js";
import { appendActivityToZohoTimeline } from "../integrations/zoho-bigin/zoho-bigin-timeline.service.js";
import {
  getProposal,
  recordProposalSentAfterProviderConfirmation,
  toProposalDto
} from "./proposal.service.js";
import type { SendApprovedProposalInput } from "./proposal.schemas.js";

interface SendApprovedProposalOptions {
  env?: NodeJS.ProcessEnv;
  emailProvider?: EmailProvider;
  zohoTransport?: typeof fetch;
}

function assertSendable(proposal: Awaited<ReturnType<typeof getProposal>>): void {
  if (proposal.status !== "APPROVED") {
    throw new AppError(409, "CONFLICT", "Only approved proposals can be sent");
  }
  if (!proposal.approvedVersion) {
    throw new AppError(409, "CONFLICT", "Approved proposal version is missing");
  }
}

async function syncProposalSentActivityToZoho(input: {
  proposalId: string;
  leadId: string;
  env?: NodeJS.ProcessEnv;
  transport?: typeof fetch;
}): Promise<ZohoTimelineAppendDto> {
  const activity = await prisma.activity.findFirst({
    where: {
      leadId: input.leadId,
      type: "PROPOSAL_SENT",
      description: { contains: input.proposalId }
    },
    orderBy: { createdAt: "desc" }
  });
  if (!activity) throw new AppError(409, "CONFLICT", "Proposal sent activity was not found");

  const result = await appendActivityToZohoTimeline({
    activityId: activity.id,
    env: input.env,
    transport: input.transport
  });

  await prisma.proposal.update({
    where: { id: input.proposalId },
    data: {
      zohoTimelineSyncStatus: result.status === "SKIPPED" ? "SYNCED" : result.status,
      zohoTimelineLastError: result.lastError
    }
  });

  if (result.status === "FAILED" || result.status === "NOT_CONFIGURED") {
    await prisma.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "Proposal",
        entityId: input.proposalId,
        action: "PROPOSAL_ZOHO_TIMELINE_SYNC_FAILED",
        after: { status: result.status, lastError: result.lastError, activityId: activity.id }
      }
    });
  }

  return result;
}

export async function sendApprovedProposal(
  actor: AuthenticatedUser,
  proposalId: string,
  input: SendApprovedProposalInput,
  options?: SendApprovedProposalOptions
): Promise<ProposalSendResultDto> {
  const proposal = await getProposal(proposalId);

  if (proposal.sentOutboundEmailId) {
    const email = await prisma.outboundEmail.findUniqueOrThrow({
      where: { id: proposal.sentOutboundEmailId }
    });
    const outboundEmail = {
      id: email.id,
      leadId: email.leadId,
      contactId: email.contactId,
      actorUserId: email.actorUserId,
      toEmail: email.toEmail,
      fromEmail: email.fromEmail,
      replyToEmail: email.replyToEmail,
      subject: email.subject,
      provider: email.provider,
      providerMessageId: email.providerMessageId,
      idempotencyKey: email.idempotencyKey,
      status: email.status,
      failureCode: email.failureCode,
      failureMessage: email.failureMessage,
      sentAt: email.sentAt?.toISOString() ?? null,
      deliveredAt: email.deliveredAt?.toISOString() ?? null,
      bouncedAt: email.bouncedAt?.toISOString() ?? null,
      complainedAt: email.complainedAt?.toISOString() ?? null,
      createdAt: email.createdAt.toISOString(),
      updatedAt: email.updatedAt.toISOString()
    };
    if (email.status === "SENT" && proposal.zohoTimelineSyncStatus !== "SYNCED") {
      const zohoTimeline = await syncProposalSentActivityToZoho({
        proposalId: proposal.id,
        leadId: proposal.leadId,
        env: options?.env,
        transport: options?.zohoTransport
      });
      const refreshed = await getProposal(proposal.id);
      return { proposal: refreshed, outboundEmail, zohoTimeline };
    }
    return {
      proposal,
      outboundEmail,
      zohoTimeline: null
    };
  }

  assertSendable(proposal);

  const subject = input.subject ?? proposal.title;
  const approvedVersionId = proposal.approvedVersionId;
  if (!approvedVersionId) {
    throw new AppError(409, "CONFLICT", "Approved proposal version is missing");
  }
  const idempotencyKey =
    input.idempotencyKey ?? `proposal-send:${proposal.id}:${approvedVersionId}`;
  const outboundEmail = await sendOutboundEmail(
    actor,
    {
      leadId: proposal.leadId,
      subject,
      textBody: proposal.approvedVersion?.content,
      idempotencyKey
    },
    { env: options?.env, provider: options?.emailProvider }
  );

  if (outboundEmail.status !== "SENT") {
    return { proposal, outboundEmail, zohoTimeline: null };
  }

  await recordProposalSentAfterProviderConfirmation(actor, proposal.id, {
    outboundEmailId: outboundEmail.id,
    reason: "Approved proposal email sent through EmailProvider"
  });

  let zohoTimeline: ZohoTimelineAppendDto | null = null;
  try {
    zohoTimeline = await syncProposalSentActivityToZoho({
      proposalId: proposal.id,
      leadId: proposal.leadId,
      env: options?.env,
      transport: options?.zohoTransport
    });
  } catch (error) {
    const lastError = error instanceof Error ? error.message : "Zoho timeline sync failed";
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { zohoTimelineSyncStatus: "FAILED", zohoTimelineLastError: lastError }
    });
    await prisma.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "Proposal",
        entityId: proposal.id,
        action: "PROPOSAL_ZOHO_TIMELINE_SYNC_FAILED",
        after: { lastError }
      }
    });
    zohoTimeline = {
      provider: "ZOHO_BIGIN",
      status: "FAILED",
      activityId: "",
      mappingId: null,
      externalRecordId: null,
      lastError
    };
  }

  const refreshed = await prisma.proposal.findUniqueOrThrow({
    where: { id: proposal.id },
    include: {
      lead: { include: { company: true, contact: true, owner: true, stage: true } },
      deal: {
        include: {
          lead: { include: { company: true, contact: true, owner: true, stage: true } },
          stage: true,
          owner: true
        }
      },
      createdBy: true,
      approvedBy: true,
      sentBy: true,
      currentVersion: true,
      approvedVersion: true,
      versions: { orderBy: { version: "desc" } },
      statusChanges: { orderBy: { createdAt: "asc" } }
    }
  });

  return { proposal: toProposalDto(refreshed), outboundEmail, zohoTimeline };
}
