import type { ZohoLeadContactSyncDto } from "@shilabs/shared-types";
import { normalizeEmail, normalizePhone, normalizeWebsite } from "@shilabs/validation";
import { getZohoBiginConfig } from "../../../config/zoho-bigin.js";
import { AppError } from "../../../shared/errors.js";
import { prisma } from "../../../shared/prisma.js";
import { redactSecrets } from "../../../shared/redaction.js";
import type { AuthenticatedUser } from "../../auth/auth.types.js";
import type { CRMContact } from "../../crm/crm.provider.js";
import { autoStartLeadAiAutomation } from "../../followups/lead-ai-automation.service.js";
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

function nowIso(date: Date): string {
  return date.toISOString();
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return redactSecrets(error.message).slice(0, 500);
  return "Zoho Bigin lead/contact sync failed";
}

function syncStatus(counters: SyncCounters): "COMPLETED" | "PARTIAL" | "FAILED" {
  if (counters.succeededRecords > 0 && counters.failedRecords > 0) return "PARTIAL";
  if (counters.failedRecords > 0) return "FAILED";
  return "COMPLETED";
}

function contactLeadRequirement(contact: CRMContact): string {
  return `Imported from Zoho Bigin contact ${contact.externalRecordId}`;
}

export async function syncZohoLeadContacts(input: {
  actor: AuthenticatedUser;
  env?: NodeJS.ProcessEnv;
  transport?: FetchTransport;
}): Promise<ZohoLeadContactSyncDto> {
  const startedAt = new Date();
  const config = getZohoBiginConfig(input.env);

  if (config.status === "NOT_CONFIGURED") {
    const account = await upsertIntegrationAccount({
      provider: "ZOHO_BIGIN",
      key: "default",
      displayName: "Zoho Bigin",
      status: "NOT_CONFIGURED",
      secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET",
      publicConfig: {
        accountsUrl: config.accountsUrl,
        apiDomain: config.apiDomain,
        contactsModule: config.contactsModule
      },
      lastCheckedAt: startedAt,
      lastError: `Missing configuration: ${config.missing.join(", ")}`
    });
    const run = await prisma.integrationSyncRun.create({
      data: {
        integrationAccountId: account.id,
        provider: "ZOHO_BIGIN",
        operation: "LEAD_CONTACT_SYNC",
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
      startedAt: nowIso(startedAt),
      finishedAt: nowIso(startedAt),
      totalRecords: 0,
      succeededRecords: 0,
      failedRecords: 0,
      skippedRecords: 0,
      pagesFetched: 0,
      lastError: account.lastError
    };
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
      contactsModule: config.contactsModule,
      requiredScopes: config.requiredScopes
    },
    lastCheckedAt: startedAt,
    lastError: null
  });

  const run = await prisma.integrationSyncRun.create({
    data: {
      integrationAccountId: account.id,
      provider: "ZOHO_BIGIN",
      operation: "LEAD_CONTACT_SYNC",
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
      const pageResult = await provider.listContacts({ page, perPage: config.syncPerPage });
      counters.pagesFetched += 1;

      for (const contact of pageResult.records) {
        counters.totalRecords += 1;
        try {
          const outcome = await syncOneContact({
            contact,
            integrationAccountId: account.id,
            actor: input.actor,
            env: input.env
          });
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
      counters.lastError = "Zoho Bigin sync stopped at configured max page limit";
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
      startedAt: nowIso(startedAt),
      finishedAt: nowIso(finishedAt),
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
      data: {
        status: "ERROR",
        lastCheckedAt: finishedAt,
        lastError
      }
    });

    throw new AppError(503, "RETRYABLE_PROVIDER_ERROR", lastError);
  }
}

async function syncOneContact(input: {
  contact: CRMContact;
  integrationAccountId: string;
  actor: AuthenticatedUser;
  env?: NodeJS.ProcessEnv;
}): Promise<"SYNCED" | "SKIPPED"> {
  const defaultStage = await prisma.pipelineStage.findUnique({ where: { key: "NEW" } });
  if (!defaultStage) {
    throw new AppError(404, "NOT_FOUND", "Default pipeline stage not found");
  }

  const syncedLead = await prisma.$transaction(
    async (transaction) => {
      const normalizedWebsite = normalizeWebsite(input.contact.company.website);
      const companyMapping = await transaction.externalRecordMapping.findUnique({
        where: {
          provider_entityType_externalRecordId: {
            provider: "ZOHO_BIGIN",
            entityType: "COMPANY",
            externalRecordId: input.contact.company.externalRecordId
          }
        }
      });

      const company = companyMapping
        ? await transaction.company.update({
            where: { id: companyMapping.localEntityId },
            data: {
              name: input.contact.company.name,
              website: input.contact.company.website ?? null,
              normalizedWebsite
            }
          })
        : await transaction.company.create({
            data: {
              name: input.contact.company.name,
              website: input.contact.company.website ?? null,
              normalizedWebsite
            }
          });

      await transaction.externalRecordMapping.upsert({
        where: {
          provider_entityType_externalRecordId: {
            provider: "ZOHO_BIGIN",
            entityType: "COMPANY",
            externalRecordId: input.contact.company.externalRecordId
          }
        },
        create: {
          integrationAccountId: input.integrationAccountId,
          provider: "ZOHO_BIGIN",
          entityType: "COMPANY",
          localEntityId: company.id,
          externalRecordId: input.contact.company.externalRecordId,
          syncStatus: "SYNCED",
          syncDirection: "INBOUND",
          lastSyncedAt: new Date(),
          idempotencyKey: `zoho-bigin:company:${input.contact.company.externalRecordId}`
        },
        update: {
          integrationAccountId: input.integrationAccountId,
          localEntityId: company.id,
          syncStatus: "SYNCED",
          syncDirection: "INBOUND",
          lastSyncedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });

      const existingContactMapping = await transaction.externalRecordMapping.findUnique({
        where: {
          provider_entityType_externalRecordId: {
            provider: "ZOHO_BIGIN",
            entityType: "CONTACT",
            externalRecordId: input.contact.externalRecordId
          }
        }
      });
      const normalizedEmail = normalizeEmail(input.contact.email);
      const normalizedPhone = normalizePhone(input.contact.phone);

      let contactLocalId = existingContactMapping?.localEntityId;
      const identityConditions = [
        normalizedEmail ? { normalizedEmail } : null,
        normalizedPhone ? { normalizedPhone } : null,
        input.contact.whatsappId ? { whatsappId: input.contact.whatsappId } : null
      ].filter((c): c is NonNullable<typeof c> => c !== null);

      if (!contactLocalId && identityConditions.length > 0) {
        const identityMatch = await transaction.contact.findFirst({
          where: {
            companyId: company.id,
            OR: identityConditions
          }
        });
        if (identityMatch) {
          contactLocalId = identityMatch.id;
        }
      }

      if (!existingContactMapping && contactLocalId) {
        const existingLocalMapping = await transaction.externalRecordMapping.findUnique({
          where: {
            provider_entityType_localEntityId: {
              provider: "ZOHO_BIGIN",
              entityType: "CONTACT",
              localEntityId: contactLocalId
            }
          }
        });
        if (existingLocalMapping) return { skipped: true as const };
      }

      if (existingContactMapping && contactLocalId && identityConditions.length > 0) {
        const conflictingContact = await transaction.contact.findFirst({
          where: {
            companyId: company.id,
            OR: identityConditions,
            NOT: { id: contactLocalId }
          }
        });
        if (conflictingContact) return { skipped: true as const };
      }

      const contact = contactLocalId
        ? await transaction.contact.update({
            where: { id: contactLocalId },
            data: {
              companyId: company.id,
              firstName: input.contact.firstName,
              lastName: input.contact.lastName,
              title: input.contact.title ?? null,
              email: input.contact.email ?? null,
              normalizedEmail,
              phone: input.contact.phone ?? null,
              normalizedPhone,
              whatsappId: input.contact.whatsappId ?? null,
              source: input.contact.source ?? "ZOHO_BIGIN"
            }
          })
        : await transaction.contact.create({
            data: {
              companyId: company.id,
              firstName: input.contact.firstName,
              lastName: input.contact.lastName,
              title: input.contact.title ?? null,
              email: input.contact.email ?? null,
              normalizedEmail,
              phone: input.contact.phone ?? null,
              normalizedPhone,
              whatsappId: input.contact.whatsappId ?? null,
              source: input.contact.source ?? "ZOHO_BIGIN",
              doNotContact: false
            }
          });

      await transaction.externalRecordMapping.upsert({
        where: {
          provider_entityType_externalRecordId: {
            provider: "ZOHO_BIGIN",
            entityType: "CONTACT",
            externalRecordId: input.contact.externalRecordId
          }
        },
        create: {
          integrationAccountId: input.integrationAccountId,
          provider: "ZOHO_BIGIN",
          entityType: "CONTACT",
          localEntityId: contact.id,
          externalRecordId: input.contact.externalRecordId,
          externalVersion: input.contact.externalVersion,
          externalUpdatedAt: input.contact.externalUpdatedAt,
          syncStatus: "SYNCED",
          syncDirection: "INBOUND",
          lastSyncedAt: new Date(),
          idempotencyKey: `zoho-bigin:contact:${input.contact.externalRecordId}`
        },
        update: {
          integrationAccountId: input.integrationAccountId,
          localEntityId: contact.id,
          externalVersion: input.contact.externalVersion,
          externalUpdatedAt: input.contact.externalUpdatedAt,
          syncStatus: "SYNCED",
          syncDirection: "INBOUND",
          lastSyncedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });

      const existingLeadMapping = await transaction.externalRecordMapping.findUnique({
        where: {
          provider_entityType_externalRecordId: {
            provider: "ZOHO_BIGIN",
            entityType: "LEAD",
            externalRecordId: input.contact.externalRecordId
          }
        }
      });

      const lead = existingLeadMapping
        ? await transaction.lead.update({
            where: { id: existingLeadMapping.localEntityId },
            data: {
              companyId: company.id,
              contactId: contact.id,
              source: input.contact.source ?? "ZOHO_BIGIN"
            }
          })
        : await transaction.lead.create({
            data: {
              companyId: company.id,
              contactId: contact.id,
              stageId: defaultStage.id,
              source: input.contact.source ?? "ZOHO_BIGIN",
              requirement: contactLeadRequirement(input.contact),
              lastActivityAt: new Date()
            }
          });

      await transaction.externalRecordMapping.upsert({
        where: {
          provider_entityType_externalRecordId: {
            provider: "ZOHO_BIGIN",
            entityType: "LEAD",
            externalRecordId: input.contact.externalRecordId
          }
        },
        create: {
          integrationAccountId: input.integrationAccountId,
          provider: "ZOHO_BIGIN",
          entityType: "LEAD",
          localEntityId: lead.id,
          externalRecordId: input.contact.externalRecordId,
          externalVersion: input.contact.externalVersion,
          externalUpdatedAt: input.contact.externalUpdatedAt,
          syncStatus: "SYNCED",
          syncDirection: "INBOUND",
          lastSyncedAt: new Date(),
          idempotencyKey: `zoho-bigin:lead:${input.contact.externalRecordId}`
        },
        update: {
          integrationAccountId: input.integrationAccountId,
          localEntityId: lead.id,
          externalVersion: input.contact.externalVersion,
          externalUpdatedAt: input.contact.externalUpdatedAt,
          syncStatus: "SYNCED",
          syncDirection: "INBOUND",
          lastSyncedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });

      return { skipped: false as const, leadId: lead.id, created: !existingLeadMapping };
    },
    { maxWait: 10000, timeout: 30000 }
  );

  if (syncedLead.skipped) return "SKIPPED";

  if (syncedLead.created) {
    await autoStartLeadAiAutomation(input.actor, syncedLead.leadId, { env: input.env });
  }

  return "SYNCED";
}
