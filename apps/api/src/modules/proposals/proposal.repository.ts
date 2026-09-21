import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

const leadInclude = {
  company: true,
  contact: true,
  owner: true,
  stage: true
} satisfies Prisma.LeadInclude;

const dealInclude = {
  lead: { include: leadInclude },
  stage: true,
  owner: true
} satisfies Prisma.DealInclude;

export const proposalInclude = {
  lead: { include: leadInclude },
  deal: { include: dealInclude },
  createdBy: true,
  approvedBy: true,
  sentBy: true,
  currentVersion: true,
  approvedVersion: true,
  versions: { orderBy: { version: "desc" as const } },
  statusChanges: { orderBy: { createdAt: "asc" as const } }
} satisfies Prisma.ProposalInclude;

export type ProposalRecord = Prisma.ProposalGetPayload<{ include: typeof proposalInclude }>;

export function findProposalById(id: string): Promise<ProposalRecord | null> {
  return prisma.proposal.findUnique({ where: { id }, include: proposalInclude });
}

export function findProposalByIdempotencyKey(key: string): Promise<ProposalRecord | null> {
  return prisma.proposal.findUnique({ where: { idempotencyKey: key }, include: proposalInclude });
}

export function listProposalRecords(input: {
  where: Prisma.ProposalWhereInput;
  take: number;
}): Promise<ProposalRecord[]> {
  return prisma.proposal.findMany({
    where: input.where,
    include: proposalInclude,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: input.take
  });
}
