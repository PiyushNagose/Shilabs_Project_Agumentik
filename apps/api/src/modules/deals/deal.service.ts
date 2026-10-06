import { DealStatus, Prisma } from "@prisma/client";
import type { DealDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { findAssignableUserById, findLeadById } from "../leads/lead.repository.js";
import { toLeadDto } from "../leads/lead.service.js";
import { findPipelineStageById } from "../pipeline/pipeline.repository.js";
import { toPipelineStageDto } from "../pipeline/pipeline.service.js";
import { assertCanAccessLead, assertCanMutateLead } from "../leads/lead.permissions.js";
import type { CreateDealInput, UpdateDealInput } from "./deal.schemas.js";
import {
  createDealWithActivityAndAudit,
  findDealById,
  findDealByLeadId,
  updateDealWithActivityAndAudit,
  type DealRecord
} from "./deal.repository.js";

export function toDealDto(deal: DealRecord): DealDto {
  return {
    id: deal.id,
    leadId: deal.leadId,
    stageId: deal.stageId,
    ownerId: deal.ownerId,
    value: deal.value?.toString() ?? null,
    currency: deal.currency,
    probability: deal.probability,
    status: deal.status,
    proposalStatus: deal.proposalStatus,
    wonReason: deal.wonReason,
    lostReason: deal.lostReason,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
    lead: toLeadDto(deal.lead),
    stage: toPipelineStageDto(deal.stage),
    owner: deal.owner ? toPublicUser(deal.owner) : null
  };
}

function requireDeal(deal: DealRecord | null): DealRecord {
  if (!deal) {
    throw new AppError(404, "NOT_FOUND", "Deal not found");
  }

  return deal;
}

function statusForStage(stage: { isWon: boolean; isLost: boolean }): DealStatus {
  if (stage.isWon) {
    return DealStatus.WON;
  }

  if (stage.isLost) {
    return DealStatus.LOST;
  }

  return DealStatus.OPEN;
}

function getDealSnapshot(deal: DealRecord): Prisma.InputJsonObject {
  return {
    id: deal.id,
    leadId: deal.leadId,
    stageId: deal.stageId,
    ownerId: deal.ownerId,
    value: deal.value?.toString() ?? null,
    currency: deal.currency,
    probability: deal.probability,
    status: deal.status,
    proposalStatus: deal.proposalStatus,
    wonReason: deal.wonReason,
    lostReason: deal.lostReason
  };
}

async function ensureOwner(ownerId: string | null | undefined): Promise<void> {
  if (!ownerId) {
    return;
  }

  const owner = await findAssignableUserById(ownerId);
  if (!owner) {
    throw new AppError(404, "NOT_FOUND", "Owner not found or inactive");
  }
}

export async function createDeal(
  actor: AuthenticatedUser,
  input: CreateDealInput
): Promise<DealDto> {
  const lead = await findLeadById(input.leadId);
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }
  assertCanMutateLead(actor, lead);

  const existingDeal = await findDealByLeadId(input.leadId);
  if (existingDeal) {
    throw new AppError(409, "CONFLICT", "Lead already has a deal");
  }

  const stage = input.stageId ? await findPipelineStageById(input.stageId) : lead.stage;
  if (!stage) {
    throw new AppError(404, "NOT_FOUND", "Pipeline stage not found");
  }

  const ownerId = "ownerId" in input ? input.ownerId : (lead.ownerId ?? actor.id);
  await ensureOwner(ownerId);

  const deal = await createDealWithActivityAndAudit({
    actorId: actor.id,
    leadId: lead.id,
    activityDescription: `Deal created for lead ${lead.id}`,
    deal: {
      lead: { connect: { id: lead.id } },
      stage: { connect: { id: stage.id } },
      owner: ownerId ? { connect: { id: ownerId } } : undefined,
      value: input.value ? new Prisma.Decimal(input.value) : null,
      currency: input.currency,
      probability: input.probability ?? stage.probability,
      status: input.status ?? statusForStage(stage),
      proposalStatus: input.proposalStatus ?? null,
      wonReason: input.wonReason ?? null,
      lostReason: input.lostReason ?? null
    }
  });

  return toDealDto(deal);
}

export async function getDeal(actor: AuthenticatedUser, dealId: string): Promise<DealDto> {
  const deal = requireDeal(await findDealById(dealId));
  assertCanAccessLead(actor, deal.lead);
  return toDealDto(deal);
}

export async function updateDeal(
  actor: AuthenticatedUser,
  dealId: string,
  input: UpdateDealInput
): Promise<DealDto> {
  const existing = requireDeal(await findDealById(dealId));
  assertCanMutateLead(actor, existing.lead);
  const stage = input.stageId ? await findPipelineStageById(input.stageId) : existing.stage;

  if (!stage) {
    throw new AppError(404, "NOT_FOUND", "Pipeline stage not found");
  }

  if ("ownerId" in input) {
    await ensureOwner(input.ownerId);
  }

  const deal = await updateDealWithActivityAndAudit({
    actorId: actor.id,
    dealId,
    before: getDealSnapshot(existing),
    activityDescription: `Deal updated for lead ${existing.leadId}`,
    data: {
      stage: input.stageId ? { connect: { id: stage.id } } : undefined,
      owner:
        "ownerId" in input
          ? input.ownerId
            ? { connect: { id: input.ownerId } }
            : { disconnect: true }
          : undefined,
      value:
        "value" in input && input.value
          ? new Prisma.Decimal(input.value)
          : "value" in input
            ? null
            : undefined,
      currency: input.currency,
      probability: input.probability ?? (input.stageId ? stage.probability : undefined),
      status: input.status ?? (input.stageId ? statusForStage(stage) : undefined),
      proposalStatus: "proposalStatus" in input ? (input.proposalStatus ?? null) : undefined,
      wonReason: "wonReason" in input ? (input.wonReason ?? null) : undefined,
      lostReason: "lostReason" in input ? (input.lostReason ?? null) : undefined
    }
  });

  return toDealDto(deal);
}
