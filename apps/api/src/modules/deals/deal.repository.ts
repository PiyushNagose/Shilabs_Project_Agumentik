import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { dealEvents } from "./deal.events.js";

const dealInclude = {
  lead: {
    include: {
      company: true,
      contact: true,
      owner: true,
      stage: true
    }
  },
  stage: true,
  owner: true
} satisfies Prisma.DealInclude;

export type DealRecord = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

export async function findDealById(id: string): Promise<DealRecord | null> {
  return prisma.deal.findUnique({
    where: { id },
    include: dealInclude
  });
}

export async function findDealByLeadId(leadId: string): Promise<DealRecord | null> {
  return prisma.deal.findUnique({
    where: { leadId },
    include: dealInclude
  });
}

export async function createDealWithActivityAndAudit(input: {
  deal: Prisma.DealCreateInput;
  actorId: string;
  leadId: string;
  activityDescription: string;
}): Promise<DealRecord> {
  return prisma.$transaction(
    async (transaction) => {
      const deal = await transaction.deal.create({
        data: input.deal,
        include: dealInclude
      });

      await transaction.activity.create({
        data: {
          leadId: input.leadId,
          actorUserId: input.actorId,
          type: dealEvents.created,
          description: input.activityDescription
        }
      });

      await transaction.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actorId,
          entityType: "Deal",
          entityId: deal.id,
          action: dealEvents.created,
          after: {
            id: deal.id,
            leadId: deal.leadId,
            stageId: deal.stageId,
            ownerId: deal.ownerId,
            value: deal.value?.toString() ?? null,
            probability: deal.probability,
            status: deal.status,
            proposalStatus: deal.proposalStatus
          }
        }
      });

      return deal;
    },
    { maxWait: 10000, timeout: 30000 }
  );
}

export async function updateDealWithActivityAndAudit(input: {
  dealId: string;
  data: Prisma.DealUpdateInput;
  actorId: string;
  before: Prisma.InputJsonValue;
  activityDescription: string;
}): Promise<DealRecord> {
  return prisma.$transaction(
    async (transaction) => {
      const deal = await transaction.deal.update({
        where: { id: input.dealId },
        data: input.data,
        include: dealInclude
      });

      await transaction.activity.create({
        data: {
          leadId: deal.leadId,
          actorUserId: input.actorId,
          type: dealEvents.updated,
          description: input.activityDescription
        }
      });

      await transaction.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actorId,
          entityType: "Deal",
          entityId: deal.id,
          action: dealEvents.updated,
          before: input.before,
          after: {
            id: deal.id,
            leadId: deal.leadId,
            stageId: deal.stageId,
            ownerId: deal.ownerId,
            value: deal.value?.toString() ?? null,
            probability: deal.probability,
            status: deal.status,
            proposalStatus: deal.proposalStatus
          }
        }
      });

      return deal;
    },
    { maxWait: 10000, timeout: 30000 }
  );
}
