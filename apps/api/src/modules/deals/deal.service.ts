import { DealStatus, Prisma } from "@prisma/client";
import type { DealDto, PaginatedResponse } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { assertCanAccessLead, assertCanMutateLead, leadVisibilityWhere } from "../leads/lead.permissions.js";
import { findLeadById } from "../leads/lead.repository.js";
import { toLeadDto } from "../leads/lead.service.js";
import { findPipelineStageById } from "../pipeline/pipeline.repository.js";
import { toPipelineStageDto } from "../pipeline/pipeline.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import type { CreateDealInput, ListDealsQuery, UpdateDealInput } from "./deal.schemas.js";
import { createDealWithActivityAndAudit, findDealById, findDealByLeadId, listDealRecords, updateDealWithActivityAndAudit, type DealRecord } from "./deal.repository.js";

function workspace(actor: AuthenticatedUser): string {
  if (!actor.activeWorkspaceId) throw new AppError(403, "AUTHORIZATION_ERROR", "Active workspace required");
  return actor.activeWorkspaceId;
}

export function toDealDto(deal: DealRecord): DealDto {
  return { id: deal.id, pipelineId: deal.pipelineId, leadId: deal.leadId, stageId: deal.stageId, ownerId: deal.ownerId, value: deal.value?.toString() ?? null, currency: deal.currency, probability: deal.probability, status: deal.status, proposalStatus: deal.proposalStatus, wonReason: deal.wonReason, lostReason: deal.lostReason, closeDate: deal.closeDate?.toISOString() ?? null, createdAt: deal.createdAt.toISOString(), updatedAt: deal.updatedAt.toISOString(), lead: toLeadDto(deal.lead), stage: toPipelineStageDto(deal.stage), owner: deal.owner ? toPublicUser(deal.owner) : null };
}

function requireDeal(deal: DealRecord | null): DealRecord {
  if (!deal) throw new AppError(404, "NOT_FOUND", "Deal not found");
  return deal;
}

async function rejectUnscopedLegacyDeal(dealId: string): Promise<void> {
  const legacy = await prisma.deal.findFirst({
    where: { id: dealId, workspaceId: null, lead: { workspaceId: null } },
    select: { id: true }
  });
  if (legacy) throw new AppError(403, "AUTHORIZATION_ERROR", "Deal requires workspace migration");
}

function statusForStage(stage: { isWon: boolean; isLost: boolean }): DealStatus {
  return stage.isWon ? DealStatus.WON : stage.isLost ? DealStatus.LOST : DealStatus.OPEN;
}

function dealSnapshot(deal: DealRecord): Prisma.InputJsonObject {
  return { id: deal.id, leadId: deal.leadId, pipelineId: deal.pipelineId, stageId: deal.stageId, ownerId: deal.ownerId, value: deal.value?.toString() ?? null, currency: deal.currency, probability: deal.probability, status: deal.status, proposalStatus: deal.proposalStatus, wonReason: deal.wonReason, lostReason: deal.lostReason, closeDate: deal.closeDate?.toISOString() ?? null };
}

async function ensureOwner(workspaceId: string, ownerId: string | null | undefined): Promise<void> {
  if (!ownerId) return;
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: ownerId, status: "ACTIVE", user: { status: "ACTIVE" } }, select: { id: true } });
  if (!member) throw new AppError(404, "NOT_FOUND", "Owner is not an active workspace member");
}

async function ensureActivePipeline(workspaceId: string, pipelineId: string | null): Promise<void> {
  if (!pipelineId) throw new AppError(404, "NOT_FOUND", "Active pipeline not found");
  const pipeline = await prisma.pipeline.findFirst({ where: { id: pipelineId, workspaceId, status: "ACTIVE" }, select: { id: true } });
  if (!pipeline) throw new AppError(404, "NOT_FOUND", "Active pipeline not found");
}

export async function listDeals(actor: AuthenticatedUser, query: ListDealsQuery): Promise<PaginatedResponse<DealDto>> {
  const workspaceId = workspace(actor);
  const where: Prisma.DealWhereInput = {
    workspaceId,
    lead: leadVisibilityWhere(actor),
    pipelineId: query.pipelineId,
    stageId: query.stageId,
    ownerId: query.ownerId,
    status: query.status,
    ...(query.search ? { OR: [
      { lead: { company: { name: { contains: query.search, mode: "insensitive" } } } },
      { lead: { contact: { firstName: { contains: query.search, mode: "insensitive" } } } },
      { lead: { contact: { lastName: { contains: query.search, mode: "insensitive" } } } },
      { lead: { contact: { email: { contains: query.search, mode: "insensitive" } } } }
    ] } : {})
  };
  const result = await listDealRecords({ where, skip: (query.page - 1) * query.pageSize, take: query.pageSize });
  return { items: result.deals.map(toDealDto), page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)) };
}

export async function createDeal(actor: AuthenticatedUser, input: CreateDealInput): Promise<DealDto> {
  const workspaceId = workspace(actor);
  const lead = await findLeadById(input.leadId);
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  assertCanMutateLead(actor, lead);
  if (await findDealByLeadId(input.leadId, workspaceId)) throw new AppError(409, "CONFLICT", "Lead already has a deal");
  const stage = input.stageId ? await findPipelineStageById(input.stageId, workspaceId) : await findPipelineStageById(lead.stageId, workspaceId);
  if (!stage || stage.status === "ARCHIVED") throw new AppError(404, "NOT_FOUND", "Active pipeline stage not found");
  await ensureActivePipeline(workspaceId, stage.pipelineId);
  const ownerId = "ownerId" in input ? input.ownerId : (lead.ownerId ?? actor.id);
  await ensureOwner(workspaceId, ownerId);
  const deal = await createDealWithActivityAndAudit({ actorId: actor.id, workspaceId, leadId: lead.id, activityDescription: `Deal created in ${stage.label}`, deal: { workspaceId, pipeline: stage.pipelineId ? { connect: { id: stage.pipelineId } } : undefined, lead: { connect: { id: lead.id } }, stage: { connect: { id: stage.id } }, owner: ownerId ? { connect: { id: ownerId } } : undefined, value: input.value ? new Prisma.Decimal(input.value) : null, currency: input.currency, probability: input.probability ?? stage.probability, status: input.status ?? statusForStage(stage), proposalStatus: input.proposalStatus ?? null, wonReason: input.wonReason ?? null, lostReason: input.lostReason ?? null, closeDate: input.closeDate ? new Date(input.closeDate) : null } });
  await publishRealtimeEvent({ entityType: "deal", action: "deal-created", leadId: deal.leadId, workspaceId });
  return toDealDto(deal);
}

export async function getDeal(actor: AuthenticatedUser, dealId: string): Promise<DealDto> {
  const dealRecord = await findDealById(dealId, workspace(actor));
  if (!dealRecord) await rejectUnscopedLegacyDeal(dealId);
  const deal = requireDeal(dealRecord);
  assertCanAccessLead(actor, deal.lead);
  return toDealDto(deal);
}

export async function updateDeal(actor: AuthenticatedUser, dealId: string, input: UpdateDealInput): Promise<DealDto> {
  const workspaceId = workspace(actor);
  const dealRecord = await findDealById(dealId, workspaceId);
  if (!dealRecord) await rejectUnscopedLegacyDeal(dealId);
  const existing = requireDeal(dealRecord);
  assertCanMutateLead(actor, existing.lead);
  const stage = input.stageId ? await findPipelineStageById(input.stageId, workspaceId) : existing.stage;
  if (!stage || stage.status === "ARCHIVED") throw new AppError(404, "NOT_FOUND", "Active pipeline stage not found");
  await ensureActivePipeline(workspaceId, stage.pipelineId);
  if ("ownerId" in input) await ensureOwner(workspaceId, input.ownerId);
  const stageChanged = Boolean(input.stageId && input.stageId !== existing.stageId);
  const deal = await updateDealWithActivityAndAudit({ actorId: actor.id, workspaceId, dealId, before: dealSnapshot(existing), stageChanged, activityDescription: stageChanged ? `Deal moved from ${existing.stage.label} to ${stage.label}` : "Deal details updated", data: { pipeline: stageChanged && stage.pipelineId ? { connect: { id: stage.pipelineId } } : undefined, stage: stageChanged ? { connect: { id: stage.id } } : undefined, owner: "ownerId" in input ? input.ownerId ? { connect: { id: input.ownerId } } : { disconnect: true } : undefined, value: "value" in input ? input.value ? new Prisma.Decimal(input.value) : null : undefined, currency: input.currency, probability: input.probability ?? (stageChanged ? stage.probability : undefined), status: input.status ?? (stageChanged ? statusForStage(stage) : undefined), proposalStatus: "proposalStatus" in input ? input.proposalStatus ?? null : undefined, wonReason: "wonReason" in input ? input.wonReason ?? null : undefined, lostReason: "lostReason" in input ? input.lostReason ?? null : undefined, closeDate: "closeDate" in input ? input.closeDate ? new Date(input.closeDate) : null : undefined } });
  await publishRealtimeEvent({ entityType: "deal", action: stageChanged ? "deal-stage-changed" : "deal-updated", leadId: deal.leadId, workspaceId });
  return toDealDto(deal);
}
