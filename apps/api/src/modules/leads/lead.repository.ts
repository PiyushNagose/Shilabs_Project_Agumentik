import type { Contact, Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

const leadInclude = {
  company: true,
  contact: true,
  owner: true,
  stage: true
} satisfies Prisma.LeadInclude;

export type LeadRecord = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

export async function findContactForCompany(input: {
  contactId: string;
  companyId: string;
}): Promise<Pick<Contact, "id" | "companyId"> | null> {
  return prisma.contact.findFirst({
    where: {
      id: input.contactId,
      companyId: input.companyId
    },
    select: {
      id: true,
      companyId: true
    }
  });
}

export async function findDefaultPipelineStage(): Promise<{ id: string } | null> {
  return prisma.pipelineStage.findUnique({
    where: { key: "NEW" },
    select: { id: true }
  });
}

export async function findPipelineStageById(stageId: string): Promise<{ id: string } | null> {
  return prisma.pipelineStage.findUnique({
    where: { id: stageId },
    select: { id: true }
  });
}

export async function findAssignableUserById(userId: string): Promise<{ id: string } | null> {
  return prisma.user.findFirst({
    where: {
      id: userId,
      status: "ACTIVE"
    },
    select: { id: true }
  });
}

export async function createLead(data: Prisma.LeadCreateInput): Promise<LeadRecord> {
  return prisma.lead.create({
    data,
    include: leadInclude
  });
}

export async function findLeadById(id: string): Promise<LeadRecord | null> {
  return prisma.lead.findUnique({
    where: { id },
    include: leadInclude
  });
}

export async function listLeads(input: {
  where: Prisma.LeadWhereInput;
  orderBy: Prisma.LeadOrderByWithRelationInput;
  skip: number;
  take: number;
}): Promise<{ leads: LeadRecord[]; total: number }> {
  const [leads, total] = await prisma.$transaction([
    prisma.lead.findMany({
      where: input.where,
      orderBy: input.orderBy,
      skip: input.skip,
      take: input.take,
      include: leadInclude
    }),
    prisma.lead.count({ where: input.where })
  ]);

  return { leads, total };
}

export async function updateLead(id: string, data: Prisma.LeadUpdateInput): Promise<LeadRecord> {
  return prisma.lead.update({
    where: { id },
    data,
    include: leadInclude
  });
}

export async function createLeadWithAudit(input: {
  lead: Prisma.LeadCreateInput;
  actorId: string;
  action: string;
}): Promise<LeadRecord> {
  return prisma.$transaction(
    async (transaction) => {
      const lead = await transaction.lead.create({
        data: input.lead,
        include: leadInclude
      });

      await transaction.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actorId,
          entityType: "Lead",
          entityId: lead.id,
          action: input.action,
          after: {
            id: lead.id,
            companyId: lead.companyId,
            contactId: lead.contactId,
            ownerId: lead.ownerId,
            status: lead.status,
            stageId: lead.stageId
          }
        }
      });

      return lead;
    },
    { maxWait: 10000, timeout: 30000 }
  );
}

export async function updateLeadWithAudit(input: {
  leadId: string;
  data: Prisma.LeadUpdateInput;
  actorId: string;
  action: string;
  before: Prisma.InputJsonValue;
}): Promise<LeadRecord> {
  return prisma.$transaction(
    async (transaction) => {
      const lead = await transaction.lead.update({
        where: { id: input.leadId },
        data: input.data,
        include: leadInclude
      });

      await transaction.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actorId,
          entityType: "Lead",
          entityId: lead.id,
          action: input.action,
          before: input.before,
          after: {
            id: lead.id,
            ownerId: lead.ownerId,
            status: lead.status,
            nextAction: lead.nextAction,
            nextActionAt: lead.nextActionAt?.toISOString() ?? null
          }
        }
      });

      return lead;
    },
    { maxWait: 10000, timeout: 30000 }
  );
}

export async function updateLeadStageWithActivityAndAudit(input: {
  leadId: string;
  stageId: string;
  status: Prisma.LeadUpdateInput["status"];
  actorId: string;
  activityDescription: string;
  before: Prisma.InputJsonValue;
}): Promise<LeadRecord> {
  return prisma.$transaction(
    async (transaction) => {
      const lead = await transaction.lead.update({
        where: { id: input.leadId },
        data: {
          stage: { connect: { id: input.stageId } },
          status: input.status,
          lastActivityAt: new Date()
        },
        include: leadInclude
      });

      await transaction.activity.create({
        data: {
          leadId: lead.id,
          actorUserId: input.actorId,
          type: "STAGE_CHANGED",
          description: input.activityDescription
        }
      });

      await transaction.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actorId,
          entityType: "Lead",
          entityId: lead.id,
          action: "STAGE_CHANGED",
          before: input.before,
          after: {
            id: lead.id,
            stageId: lead.stageId,
            stageKey: lead.stage.key,
            status: lead.status
          }
        }
      });

      return lead;
    },
    { maxWait: 10000, timeout: 30000 }
  );
}
