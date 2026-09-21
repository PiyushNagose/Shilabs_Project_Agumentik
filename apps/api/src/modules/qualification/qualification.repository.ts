import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

const qualificationInclude = {
  evidence: { orderBy: { createdAt: "asc" } }
} satisfies Prisma.LeadQualificationInclude;

export type LeadQualificationRecord = Prisma.LeadQualificationGetPayload<{
  include: typeof qualificationInclude;
}>;

export async function findLeadForQualification(leadId: string): Promise<{ id: string } | null> {
  return prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true }
  });
}

export async function findQualificationByLeadId(
  leadId: string
): Promise<LeadQualificationRecord | null> {
  return prisma.leadQualification.findUnique({
    where: { leadId },
    include: qualificationInclude
  });
}

export async function listRecentMessagesForLead(input: { leadId: string; take: number }): Promise<
  {
    id: string;
    senderType: Prisma.MessageCreateInput["senderType"];
    body: string;
    createdAt: Date;
  }[]
> {
  return prisma.message.findMany({
    where: { conversation: { leadId: input.leadId } },
    select: { id: true, senderType: true, body: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: input.take
  });
}

export async function listMessagesForLeadByIds(input: {
  leadId: string;
  messageIds: string[];
}): Promise<{ id: string; body: string }[]> {
  return prisma.message.findMany({
    where: {
      id: { in: input.messageIds },
      conversation: { leadId: input.leadId }
    },
    select: { id: true, body: true }
  });
}

export async function upsertQualificationWithEvidence(input: {
  leadId: string;
  data: Prisma.LeadQualificationUncheckedCreateWithoutLeadInput;
  evidence: { messageId: string; quote: string }[];
  actor: { type: "USER" | "SYSTEM"; id: string | null };
  before?: Prisma.InputJsonValue;
  action: string;
  activityDescription: string;
  activityActorUserId: string | null;
}): Promise<LeadQualificationRecord> {
  return prisma.$transaction(
    async (transaction) => {
      const qualification = await transaction.leadQualification.upsert({
        where: { leadId: input.leadId },
        create: { ...input.data, leadId: input.leadId },
        update: input.data,
        include: qualificationInclude
      });

      await transaction.leadQualificationEvidence.deleteMany({
        where: { qualificationId: qualification.id }
      });
      if (input.evidence.length > 0) {
        await transaction.leadQualificationEvidence.createMany({
          data: input.evidence.map((item) => ({
            qualificationId: qualification.id,
            messageId: item.messageId,
            quote: item.quote
          })),
          skipDuplicates: true
        });
      }

      await transaction.activity.create({
        data: {
          leadId: input.leadId,
          actorUserId: input.activityActorUserId,
          type: "QUALIFICATION_UPDATED",
          description: input.activityDescription
        }
      });

      await transaction.lead.update({
        where: { id: input.leadId },
        data: { lastActivityAt: new Date() }
      });

      await transaction.auditEvent.create({
        data: {
          actorType: input.actor.type,
          actorId: input.actor.id,
          entityType: "LeadQualification",
          entityId: qualification.id,
          action: input.action,
          before: input.before,
          after: {
            id: qualification.id,
            leadId: qualification.leadId,
            need: qualification.need,
            requirement: qualification.requirement,
            budget: qualification.budget,
            budgetBand: qualification.budgetBand,
            authority: qualification.authority,
            timeline: qualification.timeline,
            businessFit: qualification.businessFit,
            decisionMakerIdentified: qualification.decisionMakerIdentified,
            urgency: qualification.urgency,
            evidenceCount: input.evidence.length
          }
        }
      });

      return transaction.leadQualification.findUniqueOrThrow({
        where: { leadId: input.leadId },
        include: qualificationInclude
      });
    },
    { maxWait: 10000, timeout: 30000 }
  );
}
