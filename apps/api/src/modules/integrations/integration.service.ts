import { IntegrationProvider, type IntegrationAccount } from "@prisma/client";
import { getCalendarConfig, getMessagingConfig, getVoiceConfig } from "@shilabs/shared-config";
import type {
  IntegrationCatalogItemDto,
  IntegrationCategoryName,
  IntegrationConnectionDto,
  IntegrationConnectionStatusName,
  IntegrationDashboardDto
} from "@shilabs/shared-types";
import { getAIConfig } from "../../config/ai.js";
import { getSelectedEmailProviderConfig } from "../../config/email-provider.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { redactSecrets } from "../../shared/redaction.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { isWorkspaceManager } from "../authorization/workspace-permissions.js";
import { createCalendarProvider, ZoomConferenceProvider } from "../calendar/calendar.provider.js";
import { isCalendarOAuthEnabled, resolveWorkspaceCalendarConfig } from "../calendar/calendar-oauth.service.js";
import { getAwsSesHealth } from "../email/email.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import { getMessagingHealth } from "../messaging/messaging.service.js";
import { getVoiceHealth } from "../voice/voice.service.js";
import { getZohoBiginHealth } from "./zoho-bigin/zoho-bigin.service.js";
import type { IntegrationCatalogKey } from "./integration.schemas.js";

interface CatalogDefinition {
  key: IntegrationCatalogKey;
  provider: IntegrationProvider;
  accountKey: string;
  name: string;
  description: string;
  category: IntegrationCategoryName;
}

const catalog: readonly CatalogDefinition[] = [
  {
    key: "zoho-bigin",
    provider: "ZOHO_BIGIN",
    accountKey: "default",
    name: "Zoho Bigin",
    description: "Import and synchronize external CRM records.",
    category: "CRM"
  },
  {
    key: "aws-ses",
    provider: "AWS_SES",
    accountKey: "default",
    name: "Amazon SES",
    description: "Production email delivery and inbound events.",
    category: "EMAIL"
  },
  {
    key: "mailpit",
    provider: "MAILPIT",
    accountKey: "default",
    name: "Mailpit",
    description: "Local and test email delivery.",
    category: "EMAIL"
  },
  {
    key: "google-calendar",
    provider: "GOOGLE_CALENDAR",
    accountKey: "default",
    name: "Google Calendar",
    description: "Availability and meeting synchronization.",
    category: "CALENDAR"
  },
  {
    key: "microsoft-calendar",
    provider: "GOOGLE_CALENDAR",
    accountKey: "microsoft",
    name: "Microsoft Calendar and Teams",
    description: "Microsoft Graph availability, calendar events, and Teams meetings.",
    category: "CALENDAR"
  },
  {
    key: "zoom-meetings",
    provider: "GOOGLE_CALENDAR",
    accountKey: "zoom",
    name: "Zoom Meetings",
    description: "Zoom conferencing attached to the selected calendar provider.",
    category: "CALENDAR"
  },
  {
    key: "openai",
    provider: "OPENAI",
    accountKey: "default",
    name: "OpenAI",
    description: "Provider-independent language and embedding capability.",
    category: "AI"
  },
  {
    key: "gemini",
    provider: "GEMINI",
    accountKey: "default",
    name: "Google Gemini",
    description: "Provider-independent language and embedding capability.",
    category: "AI"
  },
  {
    key: "twilio-whatsapp",
    provider: "TWILIO",
    accountKey: "whatsapp",
    name: "Twilio WhatsApp",
    description: "WhatsApp messaging through Twilio.",
    category: "MESSAGING"
  },
  {
    key: "meta-whatsapp",
    provider: "META_WHATSAPP",
    accountKey: "default",
    name: "Meta WhatsApp",
    description: "WhatsApp messaging through Meta Cloud API.",
    category: "MESSAGING"
  },
  {
    key: "twilio-voice",
    provider: "TWILIO",
    accountKey: "voice",
    name: "Twilio Voice",
    description: "Outbound calling through Twilio.",
    category: "VOICE"
  },
  {
    key: "exotel-voice",
    provider: "EXOTEL",
    accountKey: "voice",
    name: "Exotel Voice",
    description: "Outbound calling and voice AI through Exotel.",
    category: "VOICE"
  }
];

function workspaceIdFor(actor: AuthenticatedUser): string {
  if (!actor.activeWorkspaceId)
    throw new AppError(403, "AUTHORIZATION_ERROR", "Active workspace required");
  return actor.activeWorkspaceId;
}

export function assertCanManageIntegrations(actor: AuthenticatedUser): void {
  if (!isWorkspaceManager(actor)) {
    throw new AppError(
      403,
      "AUTHORIZATION_ERROR",
      "Integration management requires manager access"
    );
  }
}

function definition(key: string): CatalogDefinition {
  const value = catalog.find((item) => item.key === key);
  if (!value) throw new AppError(404, "NOT_FOUND", "Integration provider not found");
  return value;
}

function safeError(error: unknown): string {
  return redactSecrets(
    error instanceof Error ? error.message : "Integration health check failed"
  ).slice(0, 500);
}

function displayStatus(account: IntegrationAccount): IntegrationConnectionStatusName {
  if (account.status === "DISABLED") return "DISABLED";
  if (account.syncStatus === "SYNCING" || account.status === "SYNCING") return "SYNCING";
  if (
    account.status === "FAILED" ||
    account.status === "ERROR" ||
    account.healthStatus === "FAILED"
  )
    return "FAILED";
  if (
    account.status === "NOT_CONFIGURED" ||
    account.status === "NEEDS_ATTENTION" ||
    account.healthStatus === "NEEDS_ATTENTION"
  )
    return "NEEDS_ATTENTION";
  return "CONNECTED";
}

function toDto(account: IntegrationAccount, item: CatalogDefinition): IntegrationConnectionDto {
  return {
    id: account.id,
    key: item.key,
    provider: account.provider,
    name: account.displayName,
    description: item.description,
    category: item.category,
    status: displayStatus(account),
    healthStatus: account.healthStatus,
    syncStatus: account.syncStatus,
    configured: ["CONFIGURED", "CONNECTED", "SYNCING"].includes(account.status),
    lastCheckedAt: account.lastCheckedAt?.toISOString() ?? null,
    lastHealthyAt: account.lastHealthyAt?.toISOString() ?? null,
    lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
    lastError: account.lastError,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString()
  };
}

function isEnvironmentConfigured(item: CatalogDefinition): boolean {
  try {
    if (item.key === "zoho-bigin")
      return Boolean(
        process.env.ZOHO_BIGIN_CLIENT_ID &&
        process.env.ZOHO_BIGIN_CLIENT_SECRET &&
        process.env.ZOHO_BIGIN_REFRESH_TOKEN
      );
    if (item.key === "google-calendar") return getCalendarConfig().provider === "google";
    if (item.key === "microsoft-calendar") return getCalendarConfig().provider === "microsoft";
    if (item.key === "zoom-meetings") return getCalendarConfig().conferenceProvider === "zoom";
    if (item.key === "openai" || item.key === "gemini")
      return getAIConfig().AI_PROVIDER === item.key;
    if (item.key === "aws-ses" || item.key === "mailpit")
      return getSelectedEmailProviderConfig().provider.toLowerCase().replace("_", "-") === item.key;
    if (item.category === "MESSAGING")
      return (
        getMessagingConfig().provider ===
        (item.key === "meta-whatsapp" ? "meta_whatsapp" : "twilio_whatsapp")
      );
    if (item.category === "VOICE")
      return getVoiceConfig().provider === (item.key === "exotel-voice" ? "exotel" : "twilio");
  } catch {
    return false;
  }
  return false;
}

async function providerHealth(
  item: CatalogDefinition,
  workspaceId: string
): Promise<{ configured: boolean; error: string | null }> {
  if (item.category !== "CALENDAR" && !isEnvironmentConfigured(item))
    return { configured: false, error: "Provider is not configured on the server" };
  if (item.key === "zoho-bigin") {
    const health = await getZohoBiginHealth({ workspaceId });
    return { configured: health.configured, error: health.lastError };
  }
  if (item.key === "aws-ses" || item.key === "mailpit") {
    const health = await getAwsSesHealth({ workspaceId });
    return { configured: health.configured, error: health.lastError };
  }
  if (item.category === "CALENDAR") {
    const config = await resolveWorkspaceCalendarConfig(workspaceId);
    const health = await createCalendarProvider(config).getHealth();
    if (item.key === "zoom-meetings") {
      if (config.conferenceProvider !== "zoom") {
        return { configured: false, error: "Zoom conferencing is disabled" };
      }
      return new ZoomConferenceProvider(config).getHealth();
    }
    return {
      configured:
        health.configured &&
        health.status === "CONFIGURED" &&
        ((item.key === "google-calendar" && health.provider === "GOOGLE") ||
          (item.key === "microsoft-calendar" && health.provider === "MICROSOFT")),
      error:
        (item.key === "google-calendar" && health.provider !== "GOOGLE") ||
        (item.key === "microsoft-calendar" && health.provider !== "MICROSOFT")
          ? `${item.name} is disabled`
          : health.lastError
    };
  }
  if (item.key === "twilio-whatsapp" || item.key === "meta-whatsapp") {
    const health = await getMessagingHealth();
    return {
      configured: health.configured && health.status === "CONFIGURED",
      error: health.lastError
    };
  }
  if (item.key === "twilio-voice" || item.key === "exotel-voice") {
    const health = await getVoiceHealth({ workspaceId, accountKey: item.accountKey });
    return { configured: health.configured, error: health.lastError };
  }
  return { configured: true, error: null };
}

async function recordChange(
  actor: AuthenticatedUser,
  account: IntegrationAccount,
  action: string
): Promise<void> {
  const workspaceId = workspaceIdFor(actor);
  await prisma.auditEvent.create({
    data: {
      workspaceId,
      actorType: "USER",
      actorId: actor.id,
      actorUserId: actor.id,
      sourceType: "INTEGRATIONS",
      sourceId: account.id,
      entityType: "IntegrationConnection",
      entityId: account.id,
      action,
      after: { provider: account.provider, key: account.key, status: account.status }
    }
  });
  await publishRealtimeEvent({ workspaceId, entityType: "integration", action });
}

export async function listIntegrations(actor: AuthenticatedUser): Promise<IntegrationDashboardDto> {
  assertCanManageIntegrations(actor);
  const workspaceId = workspaceIdFor(actor);
  const [accounts, latestRuns] = await Promise.all([
    prisma.integrationAccount.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" } }),
    prisma.integrationSyncRun.findMany({ where: { workspaceId }, orderBy: { startedAt: "desc" } })
  ]);
  const connections = accounts.flatMap<IntegrationConnectionDto>((account) => {
    const item = catalog.find(
      (candidate) => candidate.provider === account.provider && candidate.accountKey === account.key
    );
    if (!item) return [];
    const latest = latestRuns.find((run) => run.integrationAccountId === account.id);
    const dto = toDto(account, item);
    if (!latest) return [dto];
    const syncStatus: IntegrationConnectionDto["syncStatus"] =
      latest.finishedAt === null ? "SYNCING" : latest.status === "FAILED" ? "FAILED" : "SUCCEEDED";
    const status: IntegrationConnectionDto["status"] =
      dto.status === "DISABLED" ? "DISABLED" : syncStatus === "SYNCING" ? "SYNCING" : dto.status;
    return [
      {
        ...dto,
        status,
        syncStatus,
        lastSyncAt: latest.finishedAt?.toISOString() ?? latest.startedAt.toISOString()
      }
    ];
  });
  const statuses = connections.map(({ status }) => status);
  return {
    connections,
    catalog: catalog.map((item): IntegrationCatalogItemDto => ({
      key: item.key,
      provider: item.provider,
      name: item.name,
      description: item.description,
      category: item.category,
      configuredByEnvironment: item.key === "google-calendar" ? isCalendarOAuthEnabled() || isEnvironmentConfigured(item) : isEnvironmentConfigured(item),
      connected: connections.some((connection) => connection.key === item.key)
    })),
    summary: {
      total: connections.length,
      connected: statuses.filter((status) => status === "CONNECTED").length,
      syncing: statuses.filter((status) => status === "SYNCING").length,
      needsAttention: statuses.filter((status) => status === "NEEDS_ATTENTION").length,
      failed: statuses.filter((status) => status === "FAILED").length,
      disabled: statuses.filter((status) => status === "DISABLED").length
    }
  };
}

export async function connectIntegration(
  actor: AuthenticatedUser,
  key: IntegrationCatalogKey,
  displayName?: string
): Promise<IntegrationConnectionDto> {
  assertCanManageIntegrations(actor);
  const workspaceId = workspaceIdFor(actor);
  const item = definition(key);
  const checkedAt = new Date();
  let result: { configured: boolean; error: string | null };
  try {
    result = await providerHealth(item, workspaceId);
  } catch (error) {
    result = { configured: false, error: safeError(error) };
  }
  const account = await prisma.integrationAccount.upsert({
    where: {
      workspaceId_provider_key: { workspaceId, provider: item.provider, key: item.accountKey }
    },
    create: {
      workspaceId,
      provider: item.provider,
      key: item.accountKey,
      displayName: displayName ?? item.name,
      status: result.configured ? "CONNECTED" : "NEEDS_ATTENTION",
      healthStatus: result.configured ? "HEALTHY" : "NEEDS_ATTENTION",
      secretRef: `env:${item.key}`,
      publicConfig: { catalogKey: item.key, category: item.category },
      lastCheckedAt: checkedAt,
      lastHealthyAt: result.configured ? checkedAt : null,
      lastError: result.error
    },
    update: {
      displayName: displayName ?? item.name,
      status: result.configured ? "CONNECTED" : "NEEDS_ATTENTION",
      healthStatus: result.configured ? "HEALTHY" : "NEEDS_ATTENTION",
      disabledAt: null,
      lastCheckedAt: checkedAt,
      lastHealthyAt: result.configured ? checkedAt : undefined,
      lastError: result.error
    }
  });
  await recordChange(actor, account, "integration-connected");
  return toDto(account, item);
}

async function scoped(actor: AuthenticatedUser, id: string): Promise<IntegrationAccount> {
  const account = await prisma.integrationAccount.findFirst({
    where: { id, workspaceId: workspaceIdFor(actor) }
  });
  if (!account) throw new AppError(404, "NOT_FOUND", "Integration connection not found");
  return account;
}

export async function reconnectIntegration(
  actor: AuthenticatedUser,
  id: string
): Promise<IntegrationConnectionDto> {
  assertCanManageIntegrations(actor);
  const account = await scoped(actor, id);
  const item = catalog.find(
    (candidate) => candidate.provider === account.provider && candidate.accountKey === account.key
  );
  if (!item) throw new AppError(422, "VALIDATION_ERROR", "Integration provider is not supported");
  return connectIntegration(actor, item.key, account.displayName);
}

export async function disableIntegration(
  actor: AuthenticatedUser,
  id: string
): Promise<IntegrationConnectionDto> {
  assertCanManageIntegrations(actor);
  const current = await scoped(actor, id);
  const item = catalog.find(
    (candidate) => candidate.provider === current.provider && candidate.accountKey === current.key
  );
  if (!item) throw new AppError(422, "VALIDATION_ERROR", "Integration provider is not supported");
  const account = await prisma.$transaction(async (tx) => {
    if (current.provider === "GOOGLE_CALENDAR" && current.key === "default") {
      await tx.calendarOAuthState.deleteMany({ where: { workspaceId: workspaceIdFor(actor) } });
      await tx.workspaceCalendarCredential.updateMany({ where: { workspaceId: workspaceIdFor(actor) }, data: { disabledAt: new Date() } });
    }
    return tx.integrationAccount.update({ where: { id: current.id }, data: { status: "DISABLED", disabledAt: new Date() } });
  });
  await recordChange(actor, account, "integration-disabled");
  return toDto(account, item);
}

export async function disconnectIntegration(actor: AuthenticatedUser, id: string): Promise<void> {
  assertCanManageIntegrations(actor);
  const account = await scoped(actor, id);
  await prisma.$transaction(async (tx) => {
    if (account.provider === "GOOGLE_CALENDAR" && account.key === "default") {
      await tx.calendarOAuthState.deleteMany({ where: { workspaceId: workspaceIdFor(actor) } });
      await tx.workspaceCalendarCredential.updateMany({ where: { workspaceId: workspaceIdFor(actor) }, data: { disabledAt: new Date(), encryptedRefreshToken: "" } });
    }
    await tx.integrationAccount.delete({ where: { id: account.id } });
  });
  await prisma.auditEvent.create({
    data: {
      workspaceId: workspaceIdFor(actor),
      actorType: "USER",
      actorId: actor.id,
      actorUserId: actor.id,
      sourceType: "INTEGRATIONS",
      sourceId: account.id,
      entityType: "IntegrationConnection",
      entityId: account.id,
      action: "integration-disconnected",
      before: { provider: account.provider, key: account.key, status: account.status }
    }
  });
  await publishRealtimeEvent({
    workspaceId: workspaceIdFor(actor),
    entityType: "integration",
    action: "integration-disconnected"
  });
}
