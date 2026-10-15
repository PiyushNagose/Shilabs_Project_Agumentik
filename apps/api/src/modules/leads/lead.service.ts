import { LeadStatus, Prisma } from "@prisma/client";
import type { LeadDto, PaginatedResponse } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { getPagination, getTotalPages } from "../../shared/pagination.js";
import { prisma } from "../../shared/prisma.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { findCompanyById } from "../companies/company.repository.js";
import { toCompanyDto } from "../companies/company.service.js";
import { toContactDto } from "../contacts/contact.service.js";
import type {
  AssignLeadInput,
  CreateLeadInput,
  ListLeadsQuery,
  UpdateLeadStageInput,
  UpdateLeadInput,
  UpdateLeadStatusInput
} from "./lead.schemas.js";
import {
  createLeadWithAudit,
  findAssignableUserById,
  findContactForCompany,
  findDefaultPipelineStage,
  findLeadById,
  findPipelineStageById,
  listLeads as listLeadRecords,
  updateLeadStageWithActivityAndAudit,
  updateLeadWithAudit,
  type LeadRecord
} from "./lead.repository.js";
import { leadEvents } from "./lead.events.js";
import {
  assertCanAccessLead,
  assertCanMutateLead,
  canAssignLead,
  canCreateLeadWithOwner,
  leadVisibilityWhere
} from "./lead.permissions.js";
import { findPipelineStageById as findStageById } from "../pipeline/pipeline.repository.js";
import { ensureWorkspacePipeline } from "../pipeline/pipeline.service.js";
import { toPipelineStageDto } from "../pipeline/pipeline.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import { autoStartLeadAiAutomation } from "../followups/lead-ai-automation.service.js";
import { isTerminalLeadStatus, stopAi } from "./lead-automation-ownership.service.js";
import { sendOutboundEmail } from "../email/email.service.js";
import {
  assertCanAccessCompany,
  assertCanAccessContact
} from "../authorization/crm-record.permissions.js";

export function toLeadDto(lead: LeadRecord): LeadDto {
  return {
    id: lead.id,
    companyId: lead.companyId,
    contactId: lead.contactId,
    ownerId: lead.ownerId,
    source: lead.source,
    status: lead.status,
    stageId: lead.stageId,
    requirement: lead.requirement,
    serviceInterest: lead.serviceInterest,
    score: lead.score,
    temperature: lead.temperature,
    scoreOverrideAt: lead.scoreOverrideAt?.toISOString() ?? null,
    scoreOverrideByUserId: lead.scoreOverrideByUserId,
    scoreOverrideReason: lead.scoreOverrideReason,
    estimatedValue: lead.estimatedValue?.toString() ?? null,
    currency: lead.currency,
    nextAction: lead.nextAction,
    nextActionAt: lead.nextActionAt?.toISOString() ?? null,
    automationOwnershipState: lead.automationOwnershipState,
    automationOwnershipChangedAt: lead.automationOwnershipChangedAt.toISOString(),
    automationOwnershipReason: lead.automationOwnershipReason,
    lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    company: toCompanyDto(lead.company),
    contact: toContactDto(lead.contact),
    owner: lead.owner ? toPublicUser(lead.owner) : null,
    stage: toPipelineStageDto(lead.stage)
  };
}

function shouldSendAutomaticAcknowledgement(env: NodeJS.ProcessEnv = process.env): boolean {
  if (
    (env.NODE_ENV === "test" || env.VITEST === "true") &&
    env.LEAD_ACK_ON_CREATE_IN_TEST !== "true"
  ) {
    return false;
  }
  return env.LEAD_ACK_ON_CREATE !== "false";
}

async function sendAutomaticLeadAcknowledgement(
  actor: AuthenticatedUser,
  lead: LeadRecord
): Promise<void> {
  if (!shouldSendAutomaticAcknowledgement() || !lead.contact.email) return;
  const contactName = lead.contact.firstName.trim() || "there";
  const body = `Hi ${contactName},\n\nThank you for contacting Shilabs. We have received your request, and a member of our team will review it and follow up with you shortly.\n\nBest regards,\nShilabs`;
  const outbound = await sendOutboundEmail(actor, {
    leadId: lead.id,
    subject: "We received your request",
    textBody: body,
    idempotencyKey: `lead-acknowledgement:${lead.id}`
  });
  if (outbound.status !== "SENT") return;

  await prisma.$transaction(async (tx) => {
    const existingConversation = await tx.conversation.findFirst({
      where: { leadId: lead.id, channel: "EMAIL", status: "OPEN" },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    const conversation =
      existingConversation ??
      (await tx.conversation.create({
        data: { leadId: lead.id, channel: "EMAIL", mode: "HUMAN", status: "OPEN" },
        select: { id: true }
      }));
    const message = await tx.message.upsert({
      where: { providerMessageId: outbound.providerMessageId ?? outbound.id },
      create: {
        conversationId: conversation.id,
        providerMessageId: outbound.providerMessageId ?? outbound.id,
        direction: "OUTBOUND",
        senderType: "SYSTEM",
        body,
        deliveryStatus: "SENT",
        sentAt: outbound.sentAt ? new Date(outbound.sentAt) : new Date(),
        metadata: {
          source: "AUTOMATIC_LEAD_ACKNOWLEDGEMENT",
          outboundEmailId: outbound.id
        }
      },
      update: {}
    });
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: message.sentAt ?? message.createdAt }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: lead.workspaceId,
        actorType: "SYSTEM",
        sourceType: "LEAD_INTAKE",
        sourceId: lead.id,
        entityType: "Message",
        entityId: message.id,
        action: "AUTOMATIC_ACKNOWLEDGEMENT_SENT",
        after: { leadId: lead.id, outboundEmailId: outbound.id }
      }
    });
  });
}

function requireLead(lead: LeadRecord | null): LeadRecord {
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }

  return lead;
}

async function ensureLeadInputs(input: {
  workspaceId: string;
  companyId: string;
  contactId: string;
  ownerId?: string | null;
  stageId?: string;
}): Promise<void> {
  const [company, contact, stage, owner] = await Promise.all([
    findCompanyById(input.companyId),
    findContactForCompany({
      companyId: input.companyId,
      contactId: input.contactId
    }),
    input.stageId
      ? findPipelineStageById(input.stageId, input.workspaceId)
      : findDefaultPipelineStage(input.workspaceId),
    input.ownerId ? findAssignableUserById(input.ownerId) : Promise.resolve({ id: "unassigned" })
  ]);

  if (!company) {
    throw new AppError(404, "NOT_FOUND", "Company not found");
  }

  if (!contact) {
    throw new AppError(404, "NOT_FOUND", "Contact not found for company");
  }

  if (!stage) {
    throw new AppError(404, "NOT_FOUND", "Default pipeline stage not found");
  }

  if (!owner) {
    throw new AppError(404, "NOT_FOUND", "Owner not found or inactive");
  }
}

function getEditableLeadSnapshot(lead: LeadRecord): Prisma.InputJsonObject {
  return {
    id: lead.id,
    source: lead.source,
    requirement: lead.requirement,
    serviceInterest: lead.serviceInterest,
    estimatedValue: lead.estimatedValue?.toString() ?? null,
    currency: lead.currency,
    nextAction: lead.nextAction,
    nextActionAt: lead.nextActionAt?.toISOString() ?? null
  };
}

function getAssignmentSnapshot(lead: LeadRecord): Prisma.InputJsonObject {
  return {
    id: lead.id,
    ownerId: lead.ownerId
  };
}

function getStatusSnapshot(lead: LeadRecord): Prisma.InputJsonObject {
  return {
    id: lead.id,
    status: lead.status
  };
}

function getStageSnapshot(lead: LeadRecord): Prisma.InputJsonObject {
  return {
    id: lead.id,
    stageId: lead.stageId,
    stageKey: lead.stage.key,
    status: lead.status
  };
}

function statusForStage(stage: { key: string; isWon: boolean; isLost: boolean }): LeadStatus {
  if (stage.isWon) {
    return LeadStatus.WON;
  }

  if (stage.isLost) {
    return LeadStatus.LOST;
  }

  if (stage.key === "NURTURE") {
    return LeadStatus.NURTURE;
  }

  return LeadStatus.OPEN;
}

function buildLeadWhere(actor: AuthenticatedUser, query: ListLeadsQuery): Prisma.LeadWhereInput {
  const search = query.search;
  const searchTokens =
    search
      ?.split(/\s+/u)
      .map((token) => token.trim())
      .filter(Boolean) ?? [];
  const searchFields = (value: string): Prisma.LeadWhereInput[] => [
    { requirement: { contains: value, mode: "insensitive" } },
    { serviceInterest: { contains: value, mode: "insensitive" } },
    { source: { contains: value, mode: "insensitive" } },
    { company: { name: { contains: value, mode: "insensitive" } } },
    { contact: { firstName: { contains: value, mode: "insensitive" } } },
    { contact: { lastName: { contains: value, mode: "insensitive" } } },
    { contact: { email: { contains: value, mode: "insensitive" } } }
  ];

  const filters: Prisma.LeadWhereInput = {
    source: query.source,
    status: query.status,
    stageId: query.stageId,
    ownerId: query.ownerId,
    temperature: query.temperature,
    score:
      query.scoreMin !== undefined || query.scoreMax !== undefined
        ? {
            gte: query.scoreMin,
            lte: query.scoreMax
          }
        : undefined,
    OR: search
      ? [
          ...searchFields(search),
          ...(searchTokens.length > 1
            ? [
                {
                  AND: searchTokens.map((token) => ({
                    OR: searchFields(token)
                  }))
                }
              ]
            : [])
        ]
      : undefined
  };

  return { AND: [leadVisibilityWhere(actor), filters] };
}

export async function createLead(
  actor: AuthenticatedUser,
  input: CreateLeadInput
): Promise<LeadDto> {
  if (!canCreateLeadWithOwner(actor, input.ownerId)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Insufficient lead assignment permissions");
  }

  if (!actor.activeWorkspaceId)
    throw new AppError(403, "AUTHORIZATION_ERROR", "Active workspace required");
  await ensureWorkspacePipeline(actor.activeWorkspaceId);
  const defaultStage = await findDefaultPipelineStage(actor.activeWorkspaceId);
  if (!defaultStage) {
    throw new AppError(404, "NOT_FOUND", "Default pipeline stage not found");
  }

  const ownerId = input.ownerId ?? actor.id;
  await Promise.all([
    assertCanAccessCompany(actor, input.companyId, { allowUnlinked: true }),
    assertCanAccessContact(actor, input.contactId, { allowUnlinked: true })
  ]);
  await ensureLeadInputs({
    workspaceId: actor.activeWorkspaceId,
    companyId: input.companyId,
    contactId: input.contactId,
    ownerId,
    stageId: defaultStage.id
  });

  const lead = await createLeadWithAudit({
    actorId: actor.id,
    action: leadEvents.created,
    lead: {
      company: { connect: { id: input.companyId } },
      contact: { connect: { id: input.contactId } },
      workspaceId: actor.activeWorkspaceId,
      owner: ownerId ? { connect: { id: ownerId } } : undefined,
      stage: { connect: { id: defaultStage.id } },
      source: input.source,
      requirement: input.requirement ?? null,
      serviceInterest: input.serviceInterest ?? null,
      estimatedValue: input.estimatedValue ? new Prisma.Decimal(input.estimatedValue) : null,
      currency: input.currency,
      nextAction: input.nextAction ?? null,
      nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null,
      lastActivityAt: new Date()
    }
  });

  const createdLead = (await findLeadById(lead.id)) ?? lead;
  await sendAutomaticLeadAcknowledgement(actor, createdLead);
  await autoStartLeadAiAutomation(actor, lead.id);
  const hydratedLead = await findLeadById(lead.id);
  await publishRealtimeEvent({ entityType: "lead", action: "lead-created", leadId: lead.id });
  return toLeadDto(hydratedLead ?? lead);
}

export async function listLeads(
  actor: AuthenticatedUser,
  query: ListLeadsQuery
): Promise<PaginatedResponse<LeadDto>> {
  const pagination = getPagination(query);
  const orderBy: Prisma.LeadOrderByWithRelationInput =
    query.sort === "lastActivityAt"
      ? { lastActivityAt: { sort: query.direction, nulls: "last" } }
      : { createdAt: query.direction };

  const { leads, total } = await listLeadRecords({
    where: buildLeadWhere(actor, query),
    orderBy,
    skip: pagination.skip,
    take: pagination.take
  });

  return {
    items: leads.map(toLeadDto),
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: getTotalPages(total, pagination.pageSize)
  };
}

export async function getLead(actor: AuthenticatedUser, leadId: string): Promise<LeadDto> {
  const lead = requireLead(await findLeadById(leadId));
  assertCanAccessLead(actor, lead);
  return toLeadDto(lead);
}

export async function updateLead(
  actor: AuthenticatedUser,
  leadId: string,
  input: UpdateLeadInput
): Promise<LeadDto> {
  const existing = requireLead(await findLeadById(leadId));
  assertCanMutateLead(actor, existing);
  const lead = await updateLeadWithAudit({
    actorId: actor.id,
    leadId,
    action: leadEvents.updated,
    data: {
      source: input.source,
      requirement: "requirement" in input ? (input.requirement ?? null) : undefined,
      serviceInterest: "serviceInterest" in input ? (input.serviceInterest ?? null) : undefined,
      estimatedValue:
        "estimatedValue" in input && input.estimatedValue
          ? new Prisma.Decimal(input.estimatedValue)
          : "estimatedValue" in input
            ? null
            : undefined,
      currency: input.currency,
      nextAction: "nextAction" in input ? (input.nextAction ?? null) : undefined,
      nextActionAt:
        "nextActionAt" in input && input.nextActionAt
          ? new Date(input.nextActionAt)
          : "nextActionAt" in input
            ? null
            : undefined
    },
    before: getEditableLeadSnapshot(existing)
  });

  await publishRealtimeEvent({ entityType: "lead", action: "lead-updated", leadId });
  return toLeadDto(lead);
}

export async function assignLead(
  actor: AuthenticatedUser,
  leadId: string,
  input: AssignLeadInput
): Promise<LeadDto> {
  if (!canAssignLead(actor)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Insufficient lead assignment permissions");
  }

  const existing = requireLead(await findLeadById(leadId));
  if (input.ownerId) {
    const owner = await findAssignableUserById(input.ownerId);
    if (!owner) {
      throw new AppError(404, "NOT_FOUND", "Owner not found or inactive");
    }
  }

  const lead = await updateLeadWithAudit({
    actorId: actor.id,
    leadId,
    action: leadEvents.assigned,
    before: getAssignmentSnapshot(existing),
    data: {
      owner: input.ownerId ? { connect: { id: input.ownerId } } : { disconnect: true }
    }
  });

  await publishRealtimeEvent({ entityType: "lead", action: "lead-assigned", leadId });
  return toLeadDto(lead);
}

export async function updateLeadStatus(
  actor: AuthenticatedUser,
  leadId: string,
  input: UpdateLeadStatusInput
): Promise<LeadDto> {
  const existing = requireLead(await findLeadById(leadId));
  assertCanMutateLead(actor, existing);
  const lead = await updateLeadWithAudit({
    actorId: actor.id,
    leadId,
    action: leadEvents.statusChanged,
    before: getStatusSnapshot(existing),
    data: {
      status: input.status
    }
  });

  await publishRealtimeEvent({ entityType: "lead", action: "lead-status-changed", leadId });
  if (isTerminalLeadStatus(lead.status)) {
    await stopAi({
      leadId,
      reason: `LEAD_${lead.status}`,
      actorType: "USER",
      actorId: actor.id,
      sourceType: "LEAD_STATUS",
      sourceId: leadId
    });
  }
  return toLeadDto(lead);
}

export async function updateLeadStage(
  actor: AuthenticatedUser,
  leadId: string,
  input: UpdateLeadStageInput
): Promise<LeadDto> {
  const existing = requireLead(await findLeadById(leadId));
  assertCanMutateLead(actor, existing);
  const targetStage = await findStageById(input.stageId, actor.activeWorkspaceId);

  if (!targetStage) {
    throw new AppError(404, "NOT_FOUND", "Pipeline stage not found");
  }

  if (existing.stage.isClosed && !targetStage.isClosed) {
    throw new AppError(409, "CONFLICT", "Closed leads cannot be reopened through this endpoint");
  }

  const lead = await updateLeadStageWithActivityAndAudit({
    actorId: actor.id,
    leadId,
    stageId: targetStage.id,
    status: statusForStage(targetStage),
    before: getStageSnapshot(existing),
    activityDescription: `Stage changed from ${existing.stage.label} to ${targetStage.label}`
  });

  await publishRealtimeEvent({ entityType: "lead", action: "lead-stage-changed", leadId });
  if (isTerminalLeadStatus(lead.status)) {
    await stopAi({
      leadId,
      reason: `LEAD_STAGE_${lead.status}`,
      actorType: "USER",
      actorId: actor.id,
      sourceType: "PIPELINE_STAGE",
      sourceId: targetStage.id
    });
  }
  return toLeadDto(lead);
}
