import type { PrismaClient } from "@prisma/client";

export interface TimelineSyncResult {
  status: "SYNCED" | "SKIPPED" | "NOT_CONFIGURED" | "FAILED";
  externalRecordId: string | null;
  lastError: string | null;
}

export interface TimelineSyncer {
  syncActivity(input: {
    activityId: string;
    env?: NodeJS.ProcessEnv;
    transport?: typeof fetch;
  }): Promise<TimelineSyncResult>;
}

interface ZohoConfig {
  status: "CONFIGURED" | "NOT_CONFIGURED";
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountsUrl: string;
  apiDomain: string;
  timelineRelatedModule: string;
  missing: string[];
}

function config(env: NodeJS.ProcessEnv = process.env): ZohoConfig {
  const missing = [
    ["ZOHO_BIGIN_CLIENT_ID", env.ZOHO_BIGIN_CLIENT_ID],
    ["ZOHO_BIGIN_CLIENT_SECRET", env.ZOHO_BIGIN_CLIENT_SECRET],
    ["ZOHO_BIGIN_REFRESH_TOKEN", env.ZOHO_BIGIN_REFRESH_TOKEN]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => String(key));
  return {
    status: missing.length > 0 ? "NOT_CONFIGURED" : "CONFIGURED",
    clientId: env.ZOHO_BIGIN_CLIENT_ID ?? "",
    clientSecret: env.ZOHO_BIGIN_CLIENT_SECRET ?? "",
    refreshToken: env.ZOHO_BIGIN_REFRESH_TOKEN ?? "",
    accountsUrl: env.ZOHO_BIGIN_ACCOUNTS_URL ?? "https://accounts.zoho.com",
    apiDomain: env.ZOHO_BIGIN_API_DOMAIN ?? "https://www.zohoapis.com",
    timelineRelatedModule: env.ZOHO_BIGIN_TIMELINE_RELATED_MODULE ?? "Contacts",
    missing
  };
}

async function getAccessToken(input: {
  config: ZohoConfig;
  transport: typeof fetch;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    refresh_token: input.config.refreshToken
  });
  const response = await input.transport(`${input.config.accountsUrl}/oauth/v2/token`, {
    method: "POST",
    body
  });
  const json = (await response.json()) as { access_token?: unknown };
  if (!response.ok || typeof json.access_token !== "string") {
    throw new Error("Zoho Bigin token refresh failed");
  }
  return json.access_token;
}

async function appendTimeline(input: {
  config: ZohoConfig;
  transport: typeof fetch;
  accessToken: string;
  relatedExternalRecordId: string;
  title: string;
  description: string;
}): Promise<string> {
  const relatedModule = encodeURIComponent(input.config.timelineRelatedModule);
  const relatedId = encodeURIComponent(input.relatedExternalRecordId);
  const response = await input.transport(
    `${input.config.apiDomain}/bigin/v2/${relatedModule}/${relatedId}/Notes`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${input.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        data: [
          {
            Note_Title: input.title,
            Note_Content: input.description
          }
        ]
      })
    }
  );
  const json = (await response.json()) as {
    data?: { status?: string; code?: string; details?: { id?: unknown } }[];
  };
  const result = json.data?.[0];
  const externalRecordId = result?.details?.id;
  if (
    !response.ok ||
    result?.status?.toLowerCase() === "error" ||
    typeof externalRecordId !== "string"
  ) {
    throw new Error(`Zoho Bigin timeline write failed: ${result?.code ?? "UNKNOWN"}`);
  }
  return externalRecordId;
}

export class ZohoTimelineSyncer implements TimelineSyncer {
  public constructor(private readonly prisma: PrismaClient) {}

  public async syncActivity(input: {
    activityId: string;
    env?: NodeJS.ProcessEnv;
    transport?: typeof fetch;
  }): Promise<TimelineSyncResult> {
    const activity = await this.prisma.activity.findUnique({
      where: { id: input.activityId },
      include: { lead: true }
    });
    if (!activity)
      return { status: "FAILED", externalRecordId: null, lastError: "Activity not found" };
    if (!activity.workspaceId)
      return { status: "FAILED", externalRecordId: null, lastError: "Activity workspace not found" };
    const workspaceId = activity.workspaceId;

    const existingMapping = await this.prisma.externalRecordMapping.findUnique({
      where: {
        workspaceId_provider_entityType_localEntityId: {
          workspaceId,
          provider: "ZOHO_BIGIN",
          entityType: "ACTIVITY",
          localEntityId: activity.id
        }
      }
    });
    if (existingMapping?.syncStatus === "SYNCED") {
      return {
        status: "SKIPPED",
        externalRecordId: existingMapping.externalRecordId,
        lastError: null
      };
    }

    const zohoConfig = config(input.env);
    if (zohoConfig.status === "NOT_CONFIGURED") {
      const lastError = `Missing configuration: ${zohoConfig.missing.join(", ")}`;
      await this.prisma.integrationAccount.upsert({
        where: {
          workspaceId_provider_key: { workspaceId, provider: "ZOHO_BIGIN", key: "default" }
        },
        create: {
          workspaceId,
          provider: "ZOHO_BIGIN",
          key: "default",
          displayName: "Zoho Bigin",
          status: "NOT_CONFIGURED",
          secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET",
          publicConfig: {
            accountsUrl: zohoConfig.accountsUrl,
            apiDomain: zohoConfig.apiDomain,
            timelineRelatedModule: zohoConfig.timelineRelatedModule
          },
          lastCheckedAt: new Date(),
          lastError
        },
        update: { status: "NOT_CONFIGURED", lastCheckedAt: new Date(), lastError }
      });
      return { status: "NOT_CONFIGURED", externalRecordId: null, lastError };
    }

    const leadMapping = await this.prisma.externalRecordMapping.findUnique({
      where: {
        workspaceId_provider_entityType_localEntityId: {
          workspaceId,
          provider: "ZOHO_BIGIN",
          entityType: "LEAD",
          localEntityId: activity.leadId
        }
      }
    });
    if (!leadMapping) {
      return {
        status: "FAILED",
        externalRecordId: null,
        lastError: "Lead is not mapped to Zoho Bigin"
      };
    }

    const account = await this.prisma.integrationAccount.upsert({
      where: {
        workspaceId_provider_key: { workspaceId, provider: "ZOHO_BIGIN", key: "default" }
      },
      create: {
        workspaceId,
        provider: "ZOHO_BIGIN",
        key: "default",
        displayName: "Zoho Bigin",
        status: "CONFIGURED",
        secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET",
        publicConfig: {
          accountsUrl: zohoConfig.accountsUrl,
          apiDomain: zohoConfig.apiDomain,
          timelineRelatedModule: zohoConfig.timelineRelatedModule
        },
        lastCheckedAt: new Date()
      },
      update: { status: "CONFIGURED", lastCheckedAt: new Date(), lastError: null }
    });

    try {
      const transport = input.transport ?? fetch;
      const accessToken = await getAccessToken({ config: zohoConfig, transport });
      const externalRecordId = await appendTimeline({
        config: zohoConfig,
        transport,
        accessToken,
        relatedExternalRecordId: leadMapping.externalRecordId,
        title: `Shilabs: ${activity.type}`,
        description: activity.description
      });
      const mapping = await this.prisma.externalRecordMapping.upsert({
        where: {
          workspaceId_provider_entityType_localEntityId: {
            workspaceId,
            provider: "ZOHO_BIGIN",
            entityType: "ACTIVITY",
            localEntityId: activity.id
          }
        },
        create: {
          workspaceId,
          integrationAccountId: account.id,
          provider: "ZOHO_BIGIN",
          entityType: "ACTIVITY",
          localEntityId: activity.id,
          externalRecordId,
          syncStatus: "SYNCED",
          syncDirection: "OUTBOUND",
          lastSyncedAt: new Date(),
          idempotencyKey: `zoho-bigin:activity:${activity.id}`
        },
        update: {
          integrationAccountId: account.id,
          externalRecordId,
          syncStatus: "SYNCED",
          syncDirection: "OUTBOUND",
          lastSyncedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
      return { status: "SYNCED", externalRecordId: mapping.externalRecordId, lastError: null };
    } catch (error) {
      const lastError =
        error instanceof Error ? error.message : "Zoho Bigin timeline append failed";
      await this.prisma.integrationAccount.update({
        where: { id: account.id },
        data: { status: "ERROR", lastCheckedAt: new Date(), lastError }
      });
      return { status: "FAILED", externalRecordId: null, lastError };
    }
  }
}
