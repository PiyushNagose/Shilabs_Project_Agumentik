import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

const knowledgeBaseInclude = {
  versions: {
    orderBy: { version: "desc" as const }
  }
} satisfies Prisma.KnowledgeBaseEntryInclude;

export type KnowledgeBaseEntryRecord = Prisma.KnowledgeBaseEntryGetPayload<{
  include: typeof knowledgeBaseInclude;
}>;

export async function listKnowledgeBaseEntries(input: {
  where: Prisma.KnowledgeBaseEntryWhereInput;
}): Promise<KnowledgeBaseEntryRecord[]> {
  return prisma.knowledgeBaseEntry.findMany({
    where: input.where,
    include: knowledgeBaseInclude,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });
}

export async function findKnowledgeBaseEntryById(
  id: string
): Promise<KnowledgeBaseEntryRecord | null> {
  return prisma.knowledgeBaseEntry.findUnique({
    where: { id },
    include: knowledgeBaseInclude
  });
}

export async function createKnowledgeBaseEntryWithVersion(input: {
  data: Prisma.KnowledgeBaseEntryCreateInput;
  version: Omit<Prisma.KnowledgeBaseVersionUncheckedCreateInput, "entryId" | "version">;
  actorId: string;
  approve: boolean;
}): Promise<KnowledgeBaseEntryRecord> {
  return prisma.$transaction(
    async (tx) => {
      const entry = await tx.knowledgeBaseEntry.create({ data: input.data });
      const version = await tx.knowledgeBaseVersion.create({
        data: {
          ...input.version,
          entryId: entry.id,
          version: 1,
          approvedByUserId: input.approve ? input.actorId : null,
          approvedAt: input.approve ? new Date() : null
        }
      });
      const updated = await tx.knowledgeBaseEntry.update({
        where: { id: entry.id },
        data: {
          activeVersionId: input.approve ? version.id : null,
          status: input.approve ? "APPROVED" : "DRAFT"
        },
        include: knowledgeBaseInclude
      });
      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actorId,
          entityType: "KnowledgeBaseEntry",
          entityId: entry.id,
          action: input.approve ? "KNOWLEDGE_ENTRY_APPROVED" : "KNOWLEDGE_ENTRY_CREATED",
          after: {
            key: entry.key,
            versionId: version.id,
            version: version.version,
            status: updated.status
          }
        }
      });
      return updated;
    },
    { maxWait: 10000, timeout: 30000 }
  );
}

export async function updateKnowledgeBaseEntryWithAudit(input: {
  entry: KnowledgeBaseEntryRecord;
  data: Prisma.KnowledgeBaseEntryUpdateInput;
  actorId: string;
}): Promise<KnowledgeBaseEntryRecord> {
  return prisma.$transaction(
    async (tx) => {
      const updated = await tx.knowledgeBaseEntry.update({
        where: { id: input.entry.id },
        data: input.data,
        include: knowledgeBaseInclude
      });
      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actorId,
          entityType: "KnowledgeBaseEntry",
          entityId: input.entry.id,
          action: "KNOWLEDGE_ENTRY_UPDATED",
          before: {
            title: input.entry.title,
            category: input.entry.category,
            status: input.entry.status,
            activeVersionId: input.entry.activeVersionId
          },
          after: {
            title: updated.title,
            category: updated.category,
            status: updated.status,
            activeVersionId: updated.activeVersionId
          }
        }
      });
      return updated;
    },
    { maxWait: 10000, timeout: 30000 }
  );
}

export async function createKnowledgeBaseCorrectionWithAudit(input: {
  entry: KnowledgeBaseEntryRecord;
  version: Omit<Prisma.KnowledgeBaseVersionUncheckedCreateInput, "entryId" | "version">;
  actorId: string;
  approve: boolean;
  reason: string;
}): Promise<KnowledgeBaseEntryRecord> {
  return prisma.$transaction(
    async (tx) => {
      const latestVersion =
        input.entry.versions.reduce((max, item) => Math.max(max, item.version), 0) + 1;
      const version = await tx.knowledgeBaseVersion.create({
        data: {
          ...input.version,
          entryId: input.entry.id,
          version: latestVersion,
          correctionOfVersionId: input.entry.activeVersionId,
          approvedByUserId: input.approve ? input.actorId : null,
          approvedAt: input.approve ? new Date() : null
        }
      });
      const updated = await tx.knowledgeBaseEntry.update({
        where: { id: input.entry.id },
        data: {
          status: input.approve ? "APPROVED" : "DRAFT",
          activeVersionId: input.approve ? version.id : input.entry.activeVersionId,
          updatedByUserId: input.actorId
        },
        include: knowledgeBaseInclude
      });
      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actorId,
          entityType: "KnowledgeBaseEntry",
          entityId: input.entry.id,
          action: "KNOWLEDGE_ENTRY_CORRECTED",
          before: {
            activeVersionId: input.entry.activeVersionId
          },
          after: {
            newVersionId: version.id,
            correctionOfVersionId: version.correctionOfVersionId,
            approved: input.approve,
            reason: input.reason
          }
        }
      });
      return updated;
    },
    { maxWait: 10000, timeout: 30000 }
  );
}
