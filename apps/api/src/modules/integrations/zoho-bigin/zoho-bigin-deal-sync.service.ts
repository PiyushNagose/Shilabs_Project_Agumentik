import { DealStatus, Prisma } from "@prisma/client";
import type { ZohoDealSyncDto } from "@shilabs/shared-types";
import { getZohoBiginConfig } from "../../../config/zoho-bigin.js";
import { AppError } from "../../../shared/errors.js";
import { prisma } from "../../../shared/prisma.js";
import { redactSecrets } from "../../../shared/redaction.js";
import type { AuthenticatedUser } from "../../auth/auth.types.js";
import type { CRMDeal } from "../../crm/crm.provider.js";
import { upsertIntegrationAccount } from "../integration-mapping.repository.js";
import { ZohoBiginAuthClient, type FetchTransport } from "./zoho-bigin.client.js";
import { ZohoBiginProvider } from "./zoho-bigin.provider.js";

interface SyncCounters {
  totalRecords: number;
  succeededRecords: number;
  failedRecords: number;
  skippedRecords: number;
  pagesFetched: number;
  lastError: string | null;
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return redactSecrets(error.message).slice(0, 500);
  return "Zoho Bigin deal sync failed";
}

function syncStatus(counters: SyncCounters): "COMPLETED" | "PARTIAL" | "FAILED" {
  if (counters.succeededRecords > 0 && counters.failedRecords > 0) return "PARTIAL";
  if (counters.failedRecords > 0) return "FAILED";
  return "COMPLETED";
}

function statusForZohoDeal(deal: CRMDeal): DealStatus {
  const status = deal.status?.trim().toUpperCase();
  const stage = deal.stageName?.trim().toUpperCase();
  if (status === "WON" || stage === "WON") return DealStatus.WON;
  if (status === "LOST" || stage === "LOST") return DealStatus.LOST;
  return DealStatus.OPEN;
}

function stageKey(value: string | undefined): string | null {
  const key = value
    ?.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (!key) return null;
  if (key === "QUALIFICATION") return "QUALIFIED";
  return key;
}

export async function syncZohoDeals(input: {
  actor: AuthenticatedUser;
  env?: NodeJS.ProcessEnv;
  transport?: FetchTransport;
}): Promise<ZohoDealSyncDto> {
  const workspaceId = input.actor.activeWorkspaceId;
  if (!workspaceId) throw new AppError(403, "AUTHORIZATION_ERROR", "Active workspace required");
  const startedAt = new Date();
  const config = getZohoBiginConfig(input.env);

  if (config.status === "NOT_CONFIGURED") {
    const account = await upsertIntegrationAccount({
      workspaceId,
      provider: "ZOHO_BIGIN",
      key: "default",
      displayName: "Zoho Bigin",
      status: "NOT_CONFIGURED",
      secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET",
      publicConfig: {
        accountsUrl: config.accountsUrl,
        apiDomain: config.apiDomain,
        dealsModule: config.dealsModule
      },
      lastCheckedAt: startedAt,
      lastError: `Missing configuration: ${config.missing.join(", ")}`
    });
    const run = await prisma.integrationSyncRun.create({
      data: {
        workspaceId,
        integrationAccountId: account.id,
        provider: "ZOHO_BIGIN",
        operation: "DEAL_SYNC",
        status: "SKIPPED",
        startedAt,
        finishedAt: startedAt,
        requestedByUserId: input.actor.id,
        lastError: account.lastError
      }
    });

    return {
      provider: "ZOHO_BIGIN",
      status: "NOT_CONFIGURED",
      runId: run.id,
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
      totalRecords: 0,
      succeededRecords: 0,
      failedRecords: 0,
      skippedRecords: 0,
      pagesFetched: 0,
      lastError: account.lastError
    };
  }

  const account = await upsertIntegrationAccount({
    workspaceId,
    provider: "ZOHO_BIGIN",
    key: "default",
    displayName: "Zoho Bigin",
    status: "CONFIGURED",
    secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET",
    publicConfig: {
      accountsUrl: config.accountsUrl,
      apiDomain: config.apiDomain,
      dealsModule: config.dealsModule,
      requiredScopes: config.requiredScopes
    },
    lastCheckedAt: startedAt,
    lastError: null
  });
  const run = await prisma.integrationSyncRun.create({
    data: {
      workspaceId,
      integrationAccountId: account.id,
      provider: "ZOHO_BIGIN",
      operation: "DEAL_SYNC",
      status: "FAILED",
      startedAt,
      requestedByUserId: input.actor.id
    }
  });
  const counters: SyncCounters = {
    totalRecords: 0,
    succeededRecords: 0,
    failedRecords: 0,
    skippedRecords: 0,
    pagesFetched: 0,
    lastError: null
  };

  try {
    const provider = new ZohoBiginProvider(new ZohoBiginAuthClient(config, input.transport));
    for (let page = 1; page <= config.syncMaxPages; page += 1) {
      const pageResult = await provider.listDeals({ page, perPage: config.syncPerPage });
      counters.pagesFetched += 1;

      for (const deal of pageResult.records) {
        counters.totalRecords += 1;
        try {
          const outcome = await syncOneDeal({ deal, integrationAccountId: account.id, workspaceId });
          if (outcome === "SKIPPED") counters.skippedRecords += 1;
          else counters.succeededRecords += 1;
        } catch (error) {
          counters.failedRecords += 1;
          counters.lastError = sanitizeError(error);
        }
      }

      if (!pageResult.moreRecords) break;
    }

    if (counters.pagesFetched === config.syncMaxPages) {
      counters.lastError = "Zoho Bigin deal sync stopped at configured max page limit";
    }

    const finishedAt = new Date();
    const status = syncStatus(counters);
    await prisma.integrationSyncRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt,
        totalRecords: counters.totalRecords,
        succeededRecords: counters.succeededRecords,
        failedRecords: counters.failedRecords,
        skippedRecords: counters.skippedRecords,
        lastError: counters.lastError
      }
    });

    return {
      provider: "ZOHO_BIGIN",
      status,
      runId: run.id,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      ...counters
    };
  } catch (error) {
    const finishedAt = new Date();
    const lastError = sanitizeError(error);
    await prisma.integrationSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt,
        totalRecords: counters.totalRecords,
        succeededRecords: counters.succeededRecords,
        failedRecords: counters.failedRecords,
        skippedRecords: counters.skippedRecords,
        lastError
      }
    });
    await prisma.integrationAccount.update({
      where: { id: account.id },
      data: { status: "ERROR", lastCheckedAt: finishedAt, lastError }
    });
    throw new AppError(503, "RETRYABLE_PROVIDER_ERROR", lastError);
  }
}

async function syncOneDeal(input: {
  deal: CRMDeal;
  integrationAccountId: string;
  workspaceId: string;
}): Promise<"SYNCED" | "SKIPPED"> {
  const leadMapping = await prisma.externalRecordMapping.findUnique({
    where: {
      workspaceId_provider_entityType_externalRecordId: {
        workspaceId: input.workspaceId,
        provider: "ZOHO_BIGIN",
        entityType: "LEAD",
        externalRecordId: input.deal.relatedLeadExternalRecordId
      }
    }
  });
  if (!leadMapping) return "SKIPPED";
  const mappedLead = await prisma.lead.findFirst({
    where: { id: leadMapping.localEntityId, workspaceId: input.workspaceId },
    select: { id: true }
  });
  if (!mappedLead) throw new AppError(409, "CONFLICT", "Lead mapping crosses workspace boundary");

  const defaultStage = await prisma.pipelineStage.findFirst({
    where: { key: "NEW", workspaceId: input.workspaceId }
  });
  if (!defaultStage) throw new AppError(404, "NOT_FOUND", "Default pipeline stage not found");

  const matchedStageKey = stageKey(input.deal.stageName);
  const stage = matchedStageKey
    ? await prisma.pipelineStage.findFirst({
        where: { key: matchedStageKey, workspaceId: input.workspaceId }
      })
    : null;
  const targetStage = stage ?? defaultStage;

  await prisma.$transaction(
    async (transaction) => {
      const existingMapping = await transaction.externalRecordMapping.findUnique({
        where: {
          workspaceId_provider_entityType_externalRecordId: {
            workspaceId: input.workspaceId,
            provider: "ZOHO_BIGIN",
            entityType: "DEAL",
            externalRecordId: input.deal.externalRecordId
          }
        }
      });
      const existingDeal = existingMapping
        ? await transaction.deal.findFirst({
            where: { id: existingMapping.localEntityId, workspaceId: input.workspaceId }
          })
        : await transaction.deal.findFirst({
            where: { leadId: leadMapping.localEntityId, workspaceId: input.workspaceId }
          });
      const value = input.deal.value ? new Prisma.Decimal(input.deal.value) : null;
      const probability = input.deal.probability ?? targetStage.probability;
      const status = statusForZohoDeal(input.deal);

      const deal = existingDeal
        ? await transaction.deal.update({
            where: { id: existingDeal.id },
            data: {
              workspaceId: input.workspaceId,
              stageId: targetStage.id,
              value,
              currency: input.deal.currency ?? existingDeal.currency,
              probability,
              status
            }
          })
        : await transaction.deal.create({
            data: {
              workspaceId: input.workspaceId,
              leadId: leadMapping.localEntityId,
              stageId: targetStage.id,
              value,
              currency: input.deal.currency ?? "INR",
              probability,
              status
            }
          });

      await transaction.externalRecordMapping.upsert({
        where: {
          workspaceId_provider_entityType_externalRecordId: {
            workspaceId: input.workspaceId,
            provider: "ZOHO_BIGIN",
            entityType: "DEAL",
            externalRecordId: input.deal.externalRecordId
          }
        },
        create: {
          workspaceId: input.workspaceId,
          integrationAccountId: input.integrationAccountId,
          provider: "ZOHO_BIGIN",
          entityType: "DEAL",
          localEntityId: deal.id,
          externalRecordId: input.deal.externalRecordId,
          externalVersion: input.deal.externalVersion,
          externalUpdatedAt: input.deal.externalUpdatedAt,
          syncStatus: "SYNCED",
          syncDirection: "INBOUND",
          lastSyncedAt: new Date(),
          idempotencyKey: `zoho-bigin:deal:${input.deal.externalRecordId}`
        },
        update: {
          integrationAccountId: input.integrationAccountId,
          localEntityId: deal.id,
          externalVersion: input.deal.externalVersion,
          externalUpdatedAt: input.deal.externalUpdatedAt,
          syncStatus: "SYNCED",
          syncDirection: "INBOUND",
          lastSyncedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
    },
    { maxWait: 10000, timeout: 30000 }
  );

  return "SYNCED";
}
