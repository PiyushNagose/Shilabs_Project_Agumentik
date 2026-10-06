import { LeadStatus, Prisma } from "@prisma/client";
import type { LeadDto, PaginatedResponse } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { getPagination, getTotalPages } from "../../shared/pagination.js";
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
import { toPipelineStageDto } from "../pipeline/pipeline.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import { autoStartLeadAiAutomation } from "../followups/lead-ai-automation.service.js";
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
    lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    company: toCompanyDto(lead.company),
    contact: toContactDto(lead.contact),
    owner: lead.owner ? toPublicUser(lead.owner) : null,
    stage: toPipelineStageDto(lead.stage)
  };
}

function requireLead(lead: LeadRecord | null): LeadRecord {
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }

  return lead;
}

async function ensureLeadInputs(input: {
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
    input.stageId ? findPipelineStageById(input.stageId) : findDefaultPipelineStage(),
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

  const defaultStage = await findDefaultPipelineStage();
  if (!defaultStage) {
    throw new AppError(404, "NOT_FOUND", "Default pipeline stage not found");
  }

  const ownerId = input.ownerId ?? actor.id;
  await Promise.all([
    assertCanAccessCompany(actor, input.companyId, { allowUnlinked: true }),
    assertCanAccessContact(actor, input.contactId, { allowUnlinked: true })
  ]);
  await ensureLeadInputs({
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
  return toLeadDto(lead);
}

export async function updateLeadStage(
  actor: AuthenticatedUser,
  leadId: string,
  input: UpdateLeadStageInput
): Promise<LeadDto> {
  const existing = requireLead(await findLeadById(leadId));
  assertCanMutateLead(actor, existing);
  const targetStage = await findStageById(input.stageId);

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
  return toLeadDto(lead);
}
