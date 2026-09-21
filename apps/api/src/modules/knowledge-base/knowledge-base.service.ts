import { Prisma } from "@prisma/client";
import type {
  ApprovedKnowledgeDto,
  KnowledgeBaseEntryDto,
  KnowledgeBaseVersionDto
} from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  createKnowledgeBaseCorrectionWithAudit,
  createKnowledgeBaseEntryWithVersion,
  findKnowledgeBaseEntryById,
  listKnowledgeBaseEntries,
  updateKnowledgeBaseEntryWithAudit,
  type KnowledgeBaseEntryRecord
} from "./knowledge-base.repository.js";
import type {
  ApprovedKnowledgeQuery,
  CreateKnowledgeBaseCorrectionInput,
  CreateKnowledgeBaseEntryInput,
  ListKnowledgeBaseQuery,
  UpdateKnowledgeBaseEntryInput
} from "./knowledge-base.schemas.js";

function toVersionDto(
  version: KnowledgeBaseEntryRecord["versions"][number]
): KnowledgeBaseVersionDto {
  return {
    id: version.id,
    entryId: version.entryId,
    version: version.version,
    content: version.content,
    sourceTitle: version.sourceTitle,
    sourceUrl: version.sourceUrl,
    sourceType: version.sourceType,
    correctionOfVersionId: version.correctionOfVersionId,
    createdByUserId: version.createdByUserId,
    approvedByUserId: version.approvedByUserId,
    approvedAt: version.approvedAt?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString()
  };
}

function getActiveVersion(
  entry: KnowledgeBaseEntryRecord
): KnowledgeBaseEntryRecord["versions"][number] | null {
  return entry.versions.find((version) => version.id === entry.activeVersionId) ?? null;
}

function toEntryDto(entry: KnowledgeBaseEntryRecord): KnowledgeBaseEntryDto {
  const activeVersion = getActiveVersion(entry);
  return {
    id: entry.id,
    key: entry.key,
    title: entry.title,
    category: entry.category,
    status: entry.status,
    activeVersionId: entry.activeVersionId,
    createdByUserId: entry.createdByUserId,
    updatedByUserId: entry.updatedByUserId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    activeVersion: activeVersion ? toVersionDto(activeVersion) : null,
    versions: entry.versions.map(toVersionDto)
  };
}

function requireEntry(entry: KnowledgeBaseEntryRecord | null): KnowledgeBaseEntryRecord {
  if (!entry) throw new AppError(404, "NOT_FOUND", "Knowledge base entry not found");
  return entry;
}

function buildWhere(
  query: ListKnowledgeBaseQuery | ApprovedKnowledgeQuery,
  approvedOnly: boolean
): Prisma.KnowledgeBaseEntryWhereInput {
  const where: Prisma.KnowledgeBaseEntryWhereInput = {
    ...(query.category ? { category: query.category } : {}),
    ...(approvedOnly
      ? { status: "APPROVED", activeVersionId: { not: null } }
      : "status" in query && query.status
        ? { status: query.status }
        : {})
  };
  if (query.q) {
    where.OR = [
      { key: { contains: query.q, mode: "insensitive" } },
      { title: { contains: query.q, mode: "insensitive" } },
      {
        versions: {
          some: {
            content: { contains: query.q, mode: "insensitive" }
          }
        }
      }
    ];
  }
  return where;
}

function toApprovedKnowledgeDto(entry: KnowledgeBaseEntryRecord): ApprovedKnowledgeDto | null {
  const activeVersion = getActiveVersion(entry);
  if (entry.status !== "APPROVED" || !activeVersion?.approvedAt) return null;
  return {
    entryId: entry.id,
    key: entry.key,
    title: entry.title,
    category: entry.category,
    versionId: activeVersion.id,
    version: activeVersion.version,
    content: activeVersion.content,
    sourceTitle: activeVersion.sourceTitle,
    sourceUrl: activeVersion.sourceUrl,
    sourceType: activeVersion.sourceType,
    approvedByUserId: activeVersion.approvedByUserId,
    approvedAt: activeVersion.approvedAt.toISOString()
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function listKnowledgeBase(
  query: ListKnowledgeBaseQuery
): Promise<KnowledgeBaseEntryDto[]> {
  return (await listKnowledgeBaseEntries({ where: buildWhere(query, false) })).map(toEntryDto);
}

export async function listApprovedKnowledge(
  query: ApprovedKnowledgeQuery
): Promise<ApprovedKnowledgeDto[]> {
  const entries = await listKnowledgeBaseEntries({ where: buildWhere(query, true) });
  return entries
    .map(toApprovedKnowledgeDto)
    .filter((item): item is ApprovedKnowledgeDto => Boolean(item))
    .slice(0, query.limit);
}

export async function getKnowledgeBaseEntry(entryId: string): Promise<KnowledgeBaseEntryDto> {
  return toEntryDto(requireEntry(await findKnowledgeBaseEntryById(entryId)));
}

export async function createKnowledgeBaseEntry(
  actor: AuthenticatedUser,
  input: CreateKnowledgeBaseEntryInput
): Promise<KnowledgeBaseEntryDto> {
  try {
    const entry = await createKnowledgeBaseEntryWithVersion({
      actorId: actor.id,
      approve: input.approve,
      data: {
        key: input.key,
        title: input.title,
        category: input.category,
        status: input.approve ? "APPROVED" : "DRAFT",
        createdBy: { connect: { id: actor.id } },
        updatedBy: { connect: { id: actor.id } }
      },
      version: {
        content: input.content,
        sourceTitle: input.sourceTitle,
        sourceUrl: input.sourceUrl ?? null,
        sourceType: input.sourceType,
        createdByUserId: actor.id
      }
    });
    return toEntryDto(entry);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, "CONFLICT", "Knowledge base key already exists");
    }
    throw error;
  }
}

export async function updateKnowledgeBaseEntry(
  actor: AuthenticatedUser,
  entryId: string,
  input: UpdateKnowledgeBaseEntryInput
): Promise<KnowledgeBaseEntryDto> {
  const entry = requireEntry(await findKnowledgeBaseEntryById(entryId));
  const updated = await updateKnowledgeBaseEntryWithAudit({
    entry,
    actorId: actor.id,
    data: {
      title: input.title,
      category: input.category,
      status: input.status,
      activeVersionId: input.status === "INACTIVE" ? null : undefined,
      updatedBy: { connect: { id: actor.id } }
    }
  });
  return toEntryDto(updated);
}

export async function correctKnowledgeBaseEntry(
  actor: AuthenticatedUser,
  entryId: string,
  input: CreateKnowledgeBaseCorrectionInput
): Promise<KnowledgeBaseEntryDto> {
  const entry = requireEntry(await findKnowledgeBaseEntryById(entryId));
  const corrected = await createKnowledgeBaseCorrectionWithAudit({
    entry,
    actorId: actor.id,
    approve: input.approve,
    reason: input.reason,
    version: {
      content: input.content,
      sourceTitle: input.sourceTitle,
      sourceUrl: input.sourceUrl ?? null,
      sourceType: input.sourceType,
      createdByUserId: actor.id
    }
  });
  return toEntryDto(corrected);
}
