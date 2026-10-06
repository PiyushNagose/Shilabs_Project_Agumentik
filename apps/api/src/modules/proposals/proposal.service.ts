import type { ProposalWorkflowStatus } from "@prisma/client";
import type {
  ProposalDto,
  ProposalStatusChangeDto,
  ProposalVersionDto
} from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import { toDealDto } from "../deals/deal.service.js";
import { findLeadById } from "../leads/lead.repository.js";
import { toLeadDto } from "../leads/lead.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import {
  findProposalById,
  findProposalByIdempotencyKey,
  listProposalRecords,
  proposalInclude,
  type ProposalRecord
} from "./proposal.repository.js";
import type {
  ApproveProposalInput,
  CreateProposalInput,
  ListProposalsQuery,
  RecordProposalSentInput,
  SubmitProposalForApprovalInput,
  UpdateProposalDraftInput
} from "./proposal.schemas.js";

function toVersionDto(version: ProposalRecord["versions"][number]): ProposalVersionDto {
  return {
    id: version.id,
    proposalId: version.proposalId,
    version: version.version,
    title: version.title,
    content: version.content,
    editSummary: version.editSummary,
    createdByUserId: version.createdByUserId,
    createdAt: version.createdAt.toISOString()
  };
}

function toStatusChangeDto(
  change: ProposalRecord["statusChanges"][number]
): ProposalStatusChangeDto {
  return {
    id: change.id,
    proposalId: change.proposalId,
    fromStatus: change.fromStatus,
    toStatus: change.toStatus,
    actorUserId: change.actorUserId,
    reason: change.reason,
    createdAt: change.createdAt.toISOString()
  };
}

export function toProposalDto(proposal: ProposalRecord): ProposalDto {
  return {
    id: proposal.id,
    leadId: proposal.leadId,
    dealId: proposal.dealId,
    title: proposal.title,
    serviceType: proposal.serviceType,
    status: proposal.status,
    currentVersionId: proposal.currentVersionId,
    approvedVersionId: proposal.approvedVersionId,
    approvedByUserId: proposal.approvedByUserId,
    approvedAt: proposal.approvedAt?.toISOString() ?? null,
    sentByUserId: proposal.sentByUserId,
    sentAt: proposal.sentAt?.toISOString() ?? null,
    sentOutboundEmailId: proposal.sentOutboundEmailId,
    zohoTimelineSyncStatus: proposal.zohoTimelineSyncStatus,
    zohoTimelineLastError: proposal.zohoTimelineLastError,
    idempotencyKey: proposal.idempotencyKey,
    createdByUserId: proposal.createdByUserId,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
    lead: toLeadDto(proposal.lead),
    deal: proposal.deal ? toDealDto(proposal.deal) : null,
    createdBy: toPublicUser(proposal.createdBy),
    approvedBy: proposal.approvedBy ? toPublicUser(proposal.approvedBy) : null,
    sentBy: proposal.sentBy ? toPublicUser(proposal.sentBy) : null,
    currentVersion: proposal.currentVersion ? toVersionDto(proposal.currentVersion) : null,
    approvedVersion: proposal.approvedVersion ? toVersionDto(proposal.approvedVersion) : null,
    versions: proposal.versions.map(toVersionDto),
    statusChanges: proposal.statusChanges.map(toStatusChangeDto)
  };
}

function requireProposal(proposal: ProposalRecord | null): ProposalRecord {
  if (!proposal) throw new AppError(404, "NOT_FOUND", "Proposal not found");
  return proposal;
}

function ensureEditable(proposal: ProposalRecord): void {
  if (proposal.status === "APPROVED" || proposal.status === "SENT") {
    throw new AppError(409, "CONFLICT", "Approved or sent proposals cannot be edited");
  }
}

function ensureStatus(
  proposal: ProposalRecord,
  allowed: readonly ProposalWorkflowStatus[],
  message: string
): void {
  if (!allowed.includes(proposal.status)) {
    throw new AppError(409, "CONFLICT", message);
  }
}

async function loadProposal(id: string): Promise<ProposalRecord> {
  return prisma.proposal.findUniqueOrThrow({ where: { id }, include: proposalInclude });
}

async function ensureLeadAndDeal(input: {
  leadId: string;
  dealId?: string;
}): Promise<void> {
  const lead = await findLeadById(input.leadId);
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (!input.dealId) return;
  const deal = await prisma.deal.findUnique({ where: { id: input.dealId }, select: { leadId: true } });
  if (!deal) throw new AppError(404, "NOT_FOUND", "Deal not found");
  if (deal.leadId !== input.leadId) {
    throw new AppError(400, "VALIDATION_ERROR", "Deal must belong to the proposal lead");
  }
}

function nextVersionNumber(proposal: ProposalRecord): number {
  return proposal.versions.reduce((max, version) => Math.max(max, version.version), 0) + 1;
}

export async function listProposals(query: ListProposalsQuery): Promise<ProposalDto[]> {
  const proposals = await listProposalRecords({
    where: {
      leadId: query.leadId,
      dealId: query.dealId,
      status: query.status
    },
    take: query.limit
  });
  return proposals.map(toProposalDto);
}

export async function getProposal(proposalId: string): Promise<ProposalDto> {
  return toProposalDto(requireProposal(await findProposalById(proposalId)));
}

export async function createProposal(
  actor: AuthenticatedUser,
  input: CreateProposalInput
): Promise<ProposalDto> {
  if (input.idempotencyKey) {
    const existing = await findProposalByIdempotencyKey(input.idempotencyKey);
    if (existing) return toProposalDto(existing);
  }
  await ensureLeadAndDeal(input);

  const proposal = await prisma.$transaction(
    async (tx) => {
      const created = await tx.proposal.create({
        data: {
          leadId: input.leadId,
          dealId: input.dealId ?? null,
          title: input.title,
          serviceType: input.serviceType ?? null,
          createdByUserId: actor.id,
          idempotencyKey: input.idempotencyKey ?? null
        }
      });
      const version = await tx.proposalVersion.create({
        data: {
          proposalId: created.id,
          version: 1,
          title: input.title,
          content: input.content,
          editSummary: input.editSummary ?? "Initial draft",
          createdByUserId: actor.id
        }
      });
      const updated = await tx.proposal.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
        include: proposalInclude
      });
      await tx.proposalStatusChange.create({
        data: {
          proposalId: created.id,
          fromStatus: null,
          toStatus: "DRAFT",
          actorUserId: actor.id,
          reason: "Proposal draft created"
        }
      });
      await tx.activity.create({
        data: {
          leadId: input.leadId,
          actorUserId: actor.id,
          type: "PROPOSAL_CREATED",
          description: `Proposal draft created: ${input.title}`
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: actor.id,
          entityType: "Proposal",
          entityId: created.id,
          action: "PROPOSAL_CREATED",
          after: { leadId: input.leadId, dealId: input.dealId ?? null, versionId: version.id }
        }
      });
      return updated;
    },
    { maxWait: 10000, timeout: 30000 }
  );

  return toProposalDto(await loadProposal(proposal.id));
}

export async function updateProposalDraft(
  actor: AuthenticatedUser,
  proposalId: string,
  input: UpdateProposalDraftInput
): Promise<ProposalDto> {
  const existing = requireProposal(await findProposalById(proposalId));
  ensureEditable(existing);
  const title = input.title ?? existing.title;
  const versionNumber = nextVersionNumber(existing);
  const proposal = await prisma.$transaction(
    async (tx) => {
      const version = await tx.proposalVersion.create({
        data: {
          proposalId: existing.id,
          version: versionNumber,
          title,
          content: input.content,
          editSummary: input.editSummary ?? null,
          createdByUserId: actor.id
        }
      });
      const updated = await tx.proposal.update({
        where: { id: existing.id },
        data: {
          title,
          serviceType: "serviceType" in input ? input.serviceType : undefined,
          currentVersionId: version.id,
          approvedVersionId: null,
          approvedByUserId: null,
          approvedAt: null
        },
        include: proposalInclude
      });
      await tx.activity.create({
        data: {
          leadId: existing.leadId,
          actorUserId: actor.id,
          type: "PROPOSAL_UPDATED",
          description: `Proposal draft updated: ${title}`
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: actor.id,
          entityType: "Proposal",
          entityId: existing.id,
          action: "PROPOSAL_UPDATED",
          before: {
            title: existing.title,
            currentVersionId: existing.currentVersionId,
            status: existing.status
          },
          after: { title, currentVersionId: version.id, version: versionNumber }
        }
      });
      return updated;
    },
    { maxWait: 10000, timeout: 30000 }
  );
  return toProposalDto(await loadProposal(proposal.id));
}

export async function submitProposalForApproval(
  actor: AuthenticatedUser,
  proposalId: string,
  input: SubmitProposalForApprovalInput
): Promise<ProposalDto> {
  const existing = requireProposal(await findProposalById(proposalId));
  ensureStatus(existing, ["DRAFT"], "Only draft proposals can be submitted for approval");
  if (!existing.currentVersionId) {
    throw new AppError(409, "CONFLICT", "Proposal must have a draft version before approval");
  }

  const proposal = await prisma.$transaction(
    async (tx) => {
      const updated = await tx.proposal.update({
        where: { id: existing.id },
        data: { status: "WAITING_APPROVAL" },
        include: proposalInclude
      });
      await tx.proposalStatusChange.create({
        data: {
          proposalId: existing.id,
          fromStatus: existing.status,
          toStatus: "WAITING_APPROVAL",
          actorUserId: actor.id,
          reason: input.reason ?? null
        }
      });
      await tx.activity.create({
        data: {
          leadId: existing.leadId,
          actorUserId: actor.id,
          type: "PROPOSAL_SUBMITTED",
          description: `Proposal submitted for approval: ${existing.title}`
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: actor.id,
          entityType: "Proposal",
          entityId: existing.id,
          action: "PROPOSAL_SUBMITTED_FOR_APPROVAL",
          before: { status: existing.status },
          after: { status: "WAITING_APPROVAL", currentVersionId: existing.currentVersionId }
        }
      });
      return updated;
    },
    { maxWait: 10000, timeout: 30000 }
  );

  return toProposalDto(await loadProposal(proposal.id));
}

export async function approveProposal(
  actor: AuthenticatedUser,
  proposalId: string,
  input: ApproveProposalInput
): Promise<ProposalDto> {
  const existing = requireProposal(await findProposalById(proposalId));
  ensureStatus(existing, ["WAITING_APPROVAL"], "Only waiting proposals can be approved");
  if (!existing.currentVersionId) {
    throw new AppError(409, "CONFLICT", "Proposal has no active draft version to approve");
  }
  const approvedVersionId = existing.currentVersionId;

  const proposal = await prisma.$transaction(
    async (tx) => {
      const updated = await tx.proposal.update({
        where: { id: existing.id },
        data: {
          status: "APPROVED",
          approvedVersionId,
          approvedByUserId: actor.id,
          approvedAt: new Date()
        },
        include: proposalInclude
      });
      await tx.proposalStatusChange.create({
        data: {
          proposalId: existing.id,
          fromStatus: existing.status,
          toStatus: "APPROVED",
          actorUserId: actor.id,
          reason: input.reason ?? null
        }
      });
      await tx.activity.create({
        data: {
          leadId: existing.leadId,
          actorUserId: actor.id,
          type: "PROPOSAL_APPROVED",
          description: `Proposal approved: ${existing.title}`
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: actor.id,
          entityType: "Proposal",
          entityId: existing.id,
          action: "PROPOSAL_APPROVED",
          before: { status: existing.status },
          after: {
            status: "APPROVED",
            approvedVersionId,
            approvedByUserId: actor.id
          }
        }
      });
      await publishDomainEvent({
        client: tx,
        eventType: "PROPOSAL_APPROVED",
        aggregateType: "Proposal",
        aggregateId: existing.id,
        correlationId: existing.id,
        idempotencyKey: `domain-event:proposal-approved:${existing.id}:${approvedVersionId}`,
        payload: {
          proposalId: existing.id,
          leadId: existing.leadId,
          dealId: existing.dealId,
          approvedVersionId
        }
      });
      return updated;
    },
    { maxWait: 10000, timeout: 30000 }
  );

  return toProposalDto(await loadProposal(proposal.id));
}

export async function recordProposalSentAfterProviderConfirmation(
  actor: AuthenticatedUser,
  proposalId: string,
  input: RecordProposalSentInput
): Promise<ProposalDto> {
  const existing = requireProposal(await findProposalById(proposalId));
  ensureStatus(existing, ["APPROVED"], "Proposal cannot be marked sent before approval");
  if (!existing.approvedVersionId || existing.approvedVersionId !== existing.currentVersionId) {
    throw new AppError(409, "CONFLICT", "Only the approved proposal version can be marked sent");
  }

  const outboundEmail = await prisma.outboundEmail.findUnique({
    where: { id: input.outboundEmailId },
    select: { id: true, leadId: true, status: true, sentAt: true }
  });
  if (!outboundEmail) throw new AppError(404, "NOT_FOUND", "Outbound email not found");
  if (outboundEmail.leadId !== existing.leadId) {
    throw new AppError(400, "VALIDATION_ERROR", "Outbound email must belong to the proposal lead");
  }
  if (outboundEmail.status !== "SENT") {
    throw new AppError(409, "CONFLICT", "Provider-confirmed sent email is required first");
  }

  const sentAt = outboundEmail.sentAt ?? new Date();
  const proposal = await prisma.$transaction(
    async (tx) => {
      const updated = await tx.proposal.update({
        where: { id: existing.id },
        data: {
          status: "SENT",
          sentByUserId: actor.id,
          sentAt,
          sentOutboundEmailId: outboundEmail.id,
          zohoTimelineSyncStatus: "PENDING",
          zohoTimelineLastError: null
        },
        include: proposalInclude
      });
      await tx.proposalStatusChange.create({
        data: {
          proposalId: existing.id,
          fromStatus: existing.status,
          toStatus: "SENT",
          actorUserId: actor.id,
          reason: input.reason ?? "Provider-confirmed proposal email sent"
        }
      });
      await tx.activity.create({
        data: {
          leadId: existing.leadId,
          actorUserId: actor.id,
          type: "PROPOSAL_SENT",
          description: `Proposal sent: ${existing.title} (${existing.id})`
        }
      });
      await tx.lead.update({
        where: { id: existing.leadId },
        data: {
          nextAction: "Await customer response",
          nextActionAt: null,
          lastActivityAt: sentAt
        }
      });
      const conversationsToResume = await tx.conversation.findMany({
        where: {
          leadId: existing.leadId,
          mode: "HUMAN",
          humanTakeovers: { none: { status: "ACTIVE" } },
          negotiationHandoffs: { none: { status: "ACTIVE" } }
        },
        select: { id: true, mode: true, status: true }
      });
      if (conversationsToResume.length > 0) {
        await tx.conversation.updateMany({
          where: { id: { in: conversationsToResume.map((conversation) => conversation.id) } },
          data: { mode: "AUTO" }
        });
        for (const conversation of conversationsToResume) {
          await tx.auditEvent.create({
            data: {
              actorType: "USER",
              actorId: actor.id,
              entityType: "Conversation",
              entityId: conversation.id,
              action: "AI_AUTOMATION_RESUMED_AFTER_PROPOSAL_SENT",
              before: {
                id: conversation.id,
                mode: conversation.mode,
                status: conversation.status
              },
              after: {
                id: conversation.id,
                mode: "AUTO",
                status: conversation.status,
                reason: "Proposal sent to customer"
              }
            }
          });
        }
      }
      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: actor.id,
          entityType: "Proposal",
          entityId: existing.id,
          action: "PROPOSAL_SENT",
          before: { status: existing.status },
          after: { status: "SENT", outboundEmailId: outboundEmail.id, sentAt: sentAt.toISOString() }
        }
      });
      await publishDomainEvent({
        client: tx,
        eventType: "PROPOSAL_SENT",
        aggregateType: "Proposal",
        aggregateId: existing.id,
        correlationId: existing.id,
        idempotencyKey: `domain-event:proposal-sent:${existing.id}:${outboundEmail.id}`,
        payload: {
          proposalId: existing.id,
          leadId: existing.leadId,
          dealId: existing.dealId,
          outboundEmailId: outboundEmail.id,
          approvedVersionId: existing.approvedVersionId
        }
      });
      return updated;
    },
    { maxWait: 10000, timeout: 30000 }
  );
  await publishRealtimeEvent({
    entityType: "lead",
    action: "proposal-sent",
    leadId: existing.leadId
  });

  return toProposalDto(await loadProposal(proposal.id));
}
