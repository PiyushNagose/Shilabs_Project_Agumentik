import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { dealEvents } from "./deal.events.js";

const dealInclude = {
  lead: { include: { company: true, contact: true, owner: true, stage: true } },
  stage: true,
  owner: true
} satisfies Prisma.DealInclude;

export type DealRecord = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

export function findDealById(id: string, workspaceId: string): Promise<DealRecord | null> {
  return prisma.deal.findFirst({ where: { id, workspaceId }, include: dealInclude });
}

export function findDealByLeadId(leadId: string, workspaceId: string): Promise<DealRecord | null> {
  return prisma.deal.findFirst({ where: { leadId, workspaceId }, include: dealInclude });
}

export async function listDealRecords(input: { where: Prisma.DealWhereInput; skip: number; take: number }): Promise<{ deals: DealRecord[]; total: number }> {
  const [deals, total] = await prisma.$transaction([
    prisma.deal.findMany({ where: input.where, include: dealInclude, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: input.skip, take: input.take }),
    prisma.deal.count({ where: input.where })
  ]);
  return { deals, total };
}

function snapshot(deal: DealRecord): Prisma.InputJsonObject {
  return { id: deal.id, leadId: deal.leadId, pipelineId: deal.pipelineId, stageId: deal.stageId, ownerId: deal.ownerId, value: deal.value?.toString() ?? null, currency: deal.currency, probability: deal.probability, status: deal.status, proposalStatus: deal.proposalStatus, closeDate: deal.closeDate?.toISOString() ?? null };
}

export async function createDealWithActivityAndAudit(input: { deal: Prisma.DealCreateInput; actorId: string; workspaceId: string; leadId: string; activityDescription: string }): Promise<DealRecord> {
  return prisma.$transaction(async (transaction) => {
    const deal = await transaction.deal.create({ data: input.deal, include: dealInclude });
    await transaction.activity.create({ data: { workspaceId: input.workspaceId, leadId: input.leadId, entityType: "DEAL", entityId: deal.id, actorType: "USER", actorUserId: input.actorId, sourceType: "CRM", type: dealEvents.created, title: "Deal created", description: input.activityDescription, visibility: "BUSINESS" } });
    await transaction.auditEvent.create({ data: { workspaceId: input.workspaceId, actorType: "USER", actorId: input.actorId, actorUserId: input.actorId, sourceType: "CRM", entityType: "Deal", entityId: deal.id, action: dealEvents.created, after: snapshot(deal) } });
    return deal;
  }, { maxWait: 10000, timeout: 30000 });
}

export async function updateDealWithActivityAndAudit(input: { dealId: string; data: Prisma.DealUpdateInput; actorId: string; workspaceId: string; before: Prisma.InputJsonValue; activityDescription: string; stageChanged: boolean }): Promise<DealRecord> {
  return prisma.$transaction(async (transaction) => {
    const deal = await transaction.deal.update({ where: { id: input.dealId }, data: input.data, include: dealInclude });
    await transaction.activity.create({ data: { workspaceId: input.workspaceId, leadId: deal.leadId, entityType: "DEAL", entityId: deal.id, actorType: "USER", actorUserId: input.actorId, sourceType: "CRM", type: dealEvents.updated, title: input.stageChanged ? "Deal stage changed" : "Deal updated", description: input.activityDescription, metadata: input.stageChanged ? { stageId: deal.stageId, stage: deal.stage.label } : undefined, visibility: "BUSINESS" } });
    await transaction.auditEvent.create({ data: { workspaceId: input.workspaceId, actorType: "USER", actorId: input.actorId, actorUserId: input.actorId, sourceType: "CRM", entityType: "Deal", entityId: deal.id, action: dealEvents.updated, before: input.before, after: snapshot(deal), metadata: input.stageChanged ? { changeType: "DEAL_STAGE_CHANGED" } : undefined } });
    return deal;
  }, { maxWait: 10000, timeout: 30000 });
}
