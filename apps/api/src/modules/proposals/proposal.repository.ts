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

export function findProposalById(id: string, workspaceId: string): Promise<ProposalRecord | null> {
  return prisma.proposal.findFirst({ where: { id, workspaceId }, include: proposalInclude });
}

export function findProposalByIdempotencyKey(
  key: string,
  workspaceId: string
): Promise<ProposalRecord | null> {
  return prisma.proposal.findFirst({
    where: { idempotencyKey: key, workspaceId },
    include: proposalInclude
  });
}

export function listProposalRecords(input: {
  workspaceId: string;
  where: Prisma.ProposalWhereInput;
  take: number;
}): Promise<ProposalRecord[]> {
  return prisma.proposal.findMany({
    where: { AND: [{ workspaceId: input.workspaceId }, input.where] },
    include: proposalInclude,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: input.take
  });
}
