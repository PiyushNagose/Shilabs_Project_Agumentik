import type {
  ExternalRecordEntityType,
  IntegrationAccount,
  IntegrationSyncRun,
  IntegrationProvider,
  Prisma
} from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

export type IntegrationAccountRecord = IntegrationAccount;
export type IntegrationSyncRunRecord = IntegrationSyncRun;

const externalRecordMappingInclude = {
  integrationAccount: true
} satisfies Prisma.ExternalRecordMappingInclude;

export type ExternalRecordMappingRecord = Prisma.ExternalRecordMappingGetPayload<{
  include: typeof externalRecordMappingInclude;
}>;

async function resolvePersistedWorkspaceId(workspaceId?: string | null): Promise<string> {
  if (workspaceId) return workspaceId;
  const workspaces = await prisma.workspace.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
    take: 2
  });
  if (workspaces.length !== 1 || !workspaces[0]) {
    throw new Error("A unique persisted workspace is required for integration access");
  }
  return workspaces[0].id;
}

export async function upsertIntegrationAccount(
  data: Prisma.IntegrationAccountUncheckedCreateInput
): Promise<IntegrationAccountRecord> {
  const workspaceId = await resolvePersistedWorkspaceId(data.workspaceId);
  return prisma.integrationAccount.upsert({
    where: {
      workspaceId_provider_key: {
        workspaceId,
        provider: data.provider,
        key: data.key ?? "default"
      }
    },
    create: data,
    update: {
      displayName: data.displayName,
      workspaceId,
      status: data.status,
      secretRef: data.secretRef,
      publicConfig: data.publicConfig ?? undefined,
      lastCheckedAt: data.lastCheckedAt,
      lastError: data.lastError
    }
  });
}

export async function findIntegrationAccount(input: {
  workspaceId?: string;
  provider: IntegrationProvider;
  key?: string;
}): Promise<IntegrationAccountRecord | null> {
  const workspaceId = await resolvePersistedWorkspaceId(input.workspaceId);
  return prisma.integrationAccount.findUnique({
    where: {
      workspaceId_provider_key: {
        workspaceId,
        provider: input.provider,
        key: input.key ?? "default"
      }
    }
  });
}

export async function createExternalRecordMapping(
  data: Prisma.ExternalRecordMappingUncheckedCreateInput
): Promise<ExternalRecordMappingRecord> {
  const workspaceId = await resolvePersistedWorkspaceId(data.workspaceId);
  return prisma.externalRecordMapping.create({
    data: { ...data, workspaceId },
    include: externalRecordMappingInclude
  });
}

export async function upsertExternalRecordMapping(
  data: Prisma.ExternalRecordMappingUncheckedCreateInput
): Promise<ExternalRecordMappingRecord> {
  const workspaceId = await resolvePersistedWorkspaceId(data.workspaceId);
  return prisma.externalRecordMapping.upsert({
    where: {
      workspaceId_provider_entityType_externalRecordId: {
        workspaceId,
        provider: data.provider,
        entityType: data.entityType,
        externalRecordId: data.externalRecordId
      }
    },
    create: data,
    update: {
      integrationAccountId: data.integrationAccountId,
      workspaceId,
      localEntityId: data.localEntityId,
      externalVersion: data.externalVersion,
      externalUpdatedAt: data.externalUpdatedAt,
      lastSyncedAt: data.lastSyncedAt,
      syncDirection: data.syncDirection,
      syncStatus: data.syncStatus,
      lastErrorCode: data.lastErrorCode,
      lastErrorMessage: data.lastErrorMessage,
      retryCount: data.retryCount,
      idempotencyKey: data.idempotencyKey
    },
    include: externalRecordMappingInclude
  });
}

export async function findMappingByLocalRecord(input: {
  workspaceId?: string;
  provider: IntegrationProvider;
  entityType: ExternalRecordEntityType;
  localEntityId: string;
}): Promise<ExternalRecordMappingRecord | null> {
  const workspaceId = await resolvePersistedWorkspaceId(input.workspaceId);
  return prisma.externalRecordMapping.findUnique({
    where: {
      workspaceId_provider_entityType_localEntityId: { ...input, workspaceId }
    },
    include: externalRecordMappingInclude
  });
}

export async function findMappingByExternalRecord(input: {
  workspaceId?: string;
  provider: IntegrationProvider;
  entityType: ExternalRecordEntityType;
  externalRecordId: string;
}): Promise<ExternalRecordMappingRecord | null> {
  const workspaceId = await resolvePersistedWorkspaceId(input.workspaceId);
  return prisma.externalRecordMapping.findUnique({
    where: {
      workspaceId_provider_entityType_externalRecordId: { ...input, workspaceId }
    },
    include: externalRecordMappingInclude
  });
}

export async function markMappingSynced(input: {
  id: string;
  workspaceId?: string;
  externalVersion?: string;
  externalUpdatedAt?: Date;
  syncedAt: Date;
}): Promise<ExternalRecordMappingRecord> {
  const workspaceId = await resolvePersistedWorkspaceId(input.workspaceId);
  const mapping = await prisma.externalRecordMapping.findFirstOrThrow({
    where: { id: input.id, workspaceId }
  });
  return prisma.externalRecordMapping.update({
    where: { id: mapping.id },
    data: {
      syncStatus: "SYNCED",
      externalVersion: input.externalVersion,
      externalUpdatedAt: input.externalUpdatedAt,
      lastSyncedAt: input.syncedAt,
      lastErrorCode: null,
      lastErrorMessage: null
    },
    include: externalRecordMappingInclude
  });
}

export async function markMappingFailed(input: {
  id: string;
  workspaceId?: string;
  errorCode: string;
  errorMessage: string;
}): Promise<ExternalRecordMappingRecord> {
  const workspaceId = await resolvePersistedWorkspaceId(input.workspaceId);
  const mapping = await prisma.externalRecordMapping.findFirstOrThrow({
    where: { id: input.id, workspaceId }
  });
  return prisma.externalRecordMapping.update({
    where: { id: mapping.id },
    data: {
      syncStatus: "FAILED",
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage,
      retryCount: { increment: 1 }
    },
    include: externalRecordMappingInclude
  });
}

export async function createIntegrationSyncRun(
  data: Prisma.IntegrationSyncRunUncheckedCreateInput
): Promise<IntegrationSyncRunRecord> {
  const workspaceId = await resolvePersistedWorkspaceId(data.workspaceId);
  return prisma.integrationSyncRun.create({ data: { ...data, workspaceId } });
}

export async function updateIntegrationSyncRun(
  id: string,
  workspaceId: string | undefined,
  data: Prisma.IntegrationSyncRunUpdateInput
): Promise<IntegrationSyncRunRecord> {
  const resolvedWorkspaceId = await resolvePersistedWorkspaceId(workspaceId);
  const run = await prisma.integrationSyncRun.findFirstOrThrow({
    where: { id, workspaceId: resolvedWorkspaceId }
  });
  return prisma.integrationSyncRun.update({
    where: { id: run.id },
    data
  });
}
