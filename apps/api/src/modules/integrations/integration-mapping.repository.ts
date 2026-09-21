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

export async function upsertIntegrationAccount(
  data: Prisma.IntegrationAccountUncheckedCreateInput
): Promise<IntegrationAccountRecord> {
  return prisma.integrationAccount.upsert({
    where: {
      provider_key: {
        provider: data.provider,
        key: data.key ?? "default"
      }
    },
    create: data,
    update: {
      displayName: data.displayName,
      status: data.status,
      secretRef: data.secretRef,
      publicConfig: data.publicConfig ?? undefined,
      lastCheckedAt: data.lastCheckedAt,
      lastError: data.lastError
    }
  });
}

export async function findIntegrationAccount(input: {
  provider: IntegrationProvider;
  key?: string;
}): Promise<IntegrationAccountRecord | null> {
  return prisma.integrationAccount.findUnique({
    where: {
      provider_key: {
        provider: input.provider,
        key: input.key ?? "default"
      }
    }
  });
}

export async function createExternalRecordMapping(
  data: Prisma.ExternalRecordMappingUncheckedCreateInput
): Promise<ExternalRecordMappingRecord> {
  return prisma.externalRecordMapping.create({
    data,
    include: externalRecordMappingInclude
  });
}

export async function upsertExternalRecordMapping(
  data: Prisma.ExternalRecordMappingUncheckedCreateInput
): Promise<ExternalRecordMappingRecord> {
  return prisma.externalRecordMapping.upsert({
    where: {
      provider_entityType_externalRecordId: {
        provider: data.provider,
        entityType: data.entityType,
        externalRecordId: data.externalRecordId
      }
    },
    create: data,
    update: {
      integrationAccountId: data.integrationAccountId,
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
  provider: IntegrationProvider;
  entityType: ExternalRecordEntityType;
  localEntityId: string;
}): Promise<ExternalRecordMappingRecord | null> {
  return prisma.externalRecordMapping.findUnique({
    where: {
      provider_entityType_localEntityId: input
    },
    include: externalRecordMappingInclude
  });
}

export async function findMappingByExternalRecord(input: {
  provider: IntegrationProvider;
  entityType: ExternalRecordEntityType;
  externalRecordId: string;
}): Promise<ExternalRecordMappingRecord | null> {
  return prisma.externalRecordMapping.findUnique({
    where: {
      provider_entityType_externalRecordId: input
    },
    include: externalRecordMappingInclude
  });
}

export async function markMappingSynced(input: {
  id: string;
  externalVersion?: string;
  externalUpdatedAt?: Date;
  syncedAt: Date;
}): Promise<ExternalRecordMappingRecord> {
  return prisma.externalRecordMapping.update({
    where: { id: input.id },
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
  errorCode: string;
  errorMessage: string;
}): Promise<ExternalRecordMappingRecord> {
  return prisma.externalRecordMapping.update({
    where: { id: input.id },
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
  return prisma.integrationSyncRun.create({ data });
}

export async function updateIntegrationSyncRun(
  id: string,
  data: Prisma.IntegrationSyncRunUpdateInput
): Promise<IntegrationSyncRunRecord> {
  return prisma.integrationSyncRun.update({
    where: { id },
    data
  });
}
