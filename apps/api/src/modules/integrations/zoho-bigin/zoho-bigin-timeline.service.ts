import type { ZohoTimelineAppendDto } from "@shilabs/shared-types";
import { getZohoBiginConfig } from "../../../config/zoho-bigin.js";
import { AppError } from "../../../shared/errors.js";
import { prisma } from "../../../shared/prisma.js";
import { upsertIntegrationAccount } from "../integration-mapping.repository.js";
import { ZohoBiginAuthClient, type FetchTransport } from "./zoho-bigin.client.js";
import { ZohoBiginProvider } from "./zoho-bigin.provider.js";

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Zoho Bigin timeline append failed";
}

export async function appendActivityToZohoTimeline(input: {
  activityId: string;
  env?: NodeJS.ProcessEnv;
  transport?: FetchTransport;
}): Promise<ZohoTimelineAppendDto> {
  const activity = await prisma.activity.findUnique({
    where: { id: input.activityId },
    include: { lead: true }
  });
  if (!activity) throw new AppError(404, "NOT_FOUND", "Activity not found");

  const existingMapping = await prisma.externalRecordMapping.findUnique({
    where: {
      provider_entityType_localEntityId: {
        provider: "ZOHO_BIGIN",
        entityType: "ACTIVITY",
        localEntityId: activity.id
      }
    }
  });
  if (existingMapping?.syncStatus === "SYNCED") {
    return {
      provider: "ZOHO_BIGIN",
      status: "SKIPPED",
      activityId: activity.id,
      mappingId: existingMapping.id,
      externalRecordId: existingMapping.externalRecordId,
      lastError: null
    };
  }

  const config = getZohoBiginConfig(input.env);
  if (config.status === "NOT_CONFIGURED") {
    await upsertIntegrationAccount({
      provider: "ZOHO_BIGIN",
      key: "default",
      displayName: "Zoho Bigin",
      status: "NOT_CONFIGURED",
      secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET",
      publicConfig: {
        accountsUrl: config.accountsUrl,
        apiDomain: config.apiDomain,
        timelineRelatedModule: config.timelineRelatedModule
      },
      lastCheckedAt: new Date(),
      lastError: `Missing configuration: ${config.missing.join(", ")}`
    });
    return {
      provider: "ZOHO_BIGIN",
      status: "NOT_CONFIGURED",
      activityId: activity.id,
      mappingId: null,
      externalRecordId: null,
      lastError: `Missing configuration: ${config.missing.join(", ")}`
    };
  }

  const leadMapping = await prisma.externalRecordMapping.findUnique({
    where: {
      provider_entityType_localEntityId: {
        provider: "ZOHO_BIGIN",
        entityType: "LEAD",
        localEntityId: activity.leadId
      }
    }
  });
  if (!leadMapping) {
    throw new AppError(409, "CONFLICT", "Lead is not mapped to Zoho Bigin");
  }

  const account = await upsertIntegrationAccount({
    provider: "ZOHO_BIGIN",
    key: "default",
    displayName: "Zoho Bigin",
    status: "CONFIGURED",
    secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET",
    publicConfig: {
      accountsUrl: config.accountsUrl,
      apiDomain: config.apiDomain,
      timelineRelatedModule: config.timelineRelatedModule
    },
    lastCheckedAt: new Date(),
    lastError: null
  });

  try {
    const provider = new ZohoBiginProvider(new ZohoBiginAuthClient(config, input.transport));
    const externalRef = await provider.appendTimelineEvent({
      localEntityId: activity.id,
      relatedExternalRecordId: leadMapping.externalRecordId,
      eventType: activity.type,
      occurredAt: activity.createdAt,
      title: `Shilabs: ${activity.type}`,
      description: activity.description,
      idempotencyKey: `zoho-bigin:activity:${activity.id}`
    });

    const mapping = await prisma.externalRecordMapping.upsert({
      where: {
        provider_entityType_localEntityId: {
          provider: "ZOHO_BIGIN",
          entityType: "ACTIVITY",
          localEntityId: activity.id
        }
      },
      create: {
        integrationAccountId: account.id,
        provider: "ZOHO_BIGIN",
        entityType: "ACTIVITY",
        localEntityId: activity.id,
        externalRecordId: externalRef.externalRecordId,
        syncStatus: "SYNCED",
        syncDirection: "OUTBOUND",
        lastSyncedAt: new Date(),
        idempotencyKey: `zoho-bigin:activity:${activity.id}`
      },
      update: {
        integrationAccountId: account.id,
        externalRecordId: externalRef.externalRecordId,
        syncStatus: "SYNCED",
        syncDirection: "OUTBOUND",
        lastSyncedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null
      }
    });

    return {
      provider: "ZOHO_BIGIN",
      status: "SYNCED",
      activityId: activity.id,
      mappingId: mapping.id,
      externalRecordId: mapping.externalRecordId,
      lastError: null
    };
  } catch (error) {
    return {
      provider: "ZOHO_BIGIN",
      status: "FAILED",
      activityId: activity.id,
      mappingId: null,
      externalRecordId: null,
      lastError: sanitizeError(error)
    };
  }
}
