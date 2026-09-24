import { IntegrationAccountStatus } from "@prisma/client";
import { getAIConfig } from "../../config/ai.js";
import { getSemrushConfig } from "../../config/semrush.js";
import { prisma } from "../../shared/prisma.js";
import { getCalendarHealth } from "../calendar/calendar.service.js";
import { getAwsSesHealth } from "../email/email.service.js";
import { getZohoBiginHealth } from "../integrations/zoho-bigin/zoho-bigin.service.js";
import { getMessagingHealth } from "../messaging/messaging.service.js";
import { getVoiceHealth } from "../voice/voice.service.js";
import type {
  CalendarHealthDto,
  IntegrationHealthDto,
  OperationsDashboardDto,
  OperationsProviderErrorDto,
  OperationsProviderHealthDto,
  OperationsUsageIndicatorDto,
  OperationsWorkItemDto
} from "@shilabs/shared-types";

type HealthStatus = OperationsProviderHealthDto["status"];

function providerStatus(status: string): HealthStatus {
  if (
    status === IntegrationAccountStatus.CONFIGURED ||
    status === IntegrationAccountStatus.NOT_CONFIGURED ||
    status === IntegrationAccountStatus.ERROR ||
    status === IntegrationAccountStatus.DISABLED
  ) {
    return status;
  }
  return "ERROR";
}

function liveHealth(input: {
  key: string;
  label: string;
  provider: string;
  status: string;
  configured: boolean;
  checkedAt?: string;
  missingConfig?: string[];
  lastError?: string | null;
}): OperationsProviderHealthDto {
  return {
    key: input.key,
    label: input.label,
    provider: input.provider,
    status: providerStatus(input.status),
    configured: input.configured,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    missingConfig: input.missingConfig ?? [],
    lastError: input.lastError ?? null,
    evidence: "LIVE_HEALTH_CHECK"
  };
}

function failedHealth(input: {
  key: string;
  label: string;
  provider: string;
  error: unknown;
}): OperationsProviderHealthDto {
  return {
    key: input.key,
    label: input.label,
    provider: input.provider,
    status: "ERROR",
    configured: false,
    checkedAt: new Date().toISOString(),
    missingConfig: [],
    lastError:
      input.error instanceof Error && input.error.message.trim()
        ? input.error.message.slice(0, 500)
        : "Health check failed",
    evidence: "LIVE_HEALTH_CHECK"
  };
}

async function safely<T>(
  fallback: (error: unknown) => OperationsProviderHealthDto,
  fn: () => Promise<T>,
  map: (value: T) => OperationsProviderHealthDto
): Promise<OperationsProviderHealthDto> {
  try {
    return map(await fn());
  } catch (error) {
    return fallback(error);
  }
}

function aiHealth(): OperationsProviderHealthDto {
  try {
    const config = getAIConfig();
    const provider = config.AI_PROVIDER === "gemini" ? "GEMINI" : "OPENAI";
    return {
      key: "ai",
      label: "AI Provider",
      provider,
      status: "CONFIGURED",
      configured: true,
      checkedAt: new Date().toISOString(),
      missingConfig: [],
      lastError: null,
      evidence: "CONFIG_ONLY"
    };
  } catch (error) {
    return {
      key: "ai",
      label: "AI Provider",
      provider: "AI",
      status: "NOT_CONFIGURED",
      configured: false,
      checkedAt: new Date().toISOString(),
      missingConfig: ["AI_PROVIDER"],
      lastError: error instanceof Error ? error.message.slice(0, 500) : "AI is not configured",
      evidence: "CONFIG_ONLY"
    };
  }
}

function semrushHealth(): OperationsProviderHealthDto {
  const config = getSemrushConfig();
  return {
    key: "semrush",
    label: "SEMrush",
    provider: "SEMRUSH",
    status: config.status,
    configured: config.status === "CONFIGURED",
    checkedAt: new Date().toISOString(),
    missingConfig: config.missing,
    lastError:
      config.status === "CONFIGURED" ? null : `Missing configuration: ${config.missing.join(", ")}`,
    evidence: "CONFIG_ONLY"
  };
}

function mapIntegrationHealth(
  key: string,
  label: string,
  health: IntegrationHealthDto
): OperationsProviderHealthDto {
  return liveHealth({
    key,
    label,
    provider: health.provider,
    status: health.status,
    configured: health.configured,
    checkedAt: health.checkedAt,
    missingConfig: health.missingConfig,
    lastError: health.lastError
  });
}

function mapCalendarHealth(health: CalendarHealthDto): OperationsProviderHealthDto {
  return liveHealth({
    key: "calendar",
    label: "Calendar",
    provider: health.provider,
    status: health.status,
    configured: health.configured,
    checkedAt: health.checkedAt,
    missingConfig: health.missingConfig,
    lastError: health.lastError
  });
}

async function getProviderHealth(): Promise<OperationsProviderHealthDto[]> {
  const [zoho, email, calendar, voice, messaging] = await Promise.all([
    safely(
      (error) => failedHealth({ key: "zoho", label: "Zoho Bigin", provider: "ZOHO_BIGIN", error }),
      () => getZohoBiginHealth(),
      (health) => mapIntegrationHealth("zoho", "Zoho Bigin", health)
    ),
    safely(
      (error) => failedHealth({ key: "email", label: "Email Provider", provider: "EMAIL", error }),
      () => getAwsSesHealth(),
      (health) => mapIntegrationHealth("email", "Email Provider", health)
    ),
    safely(
      (error) => failedHealth({ key: "calendar", label: "Calendar", provider: "CALENDAR", error }),
      () => getCalendarHealth(),
      mapCalendarHealth
    ),
    safely(
      (error) => failedHealth({ key: "voice", label: "Voice Provider", provider: "TWILIO", error }),
      () => getVoiceHealth(),
      (health) => mapIntegrationHealth("voice", "Voice Provider", health)
    ),
    safely(
      (error) =>
        failedHealth({ key: "whatsapp", label: "WhatsApp Messaging", provider: "META_WHATSAPP", error }),
      () => getMessagingHealth(),
      (health) =>
        liveHealth({
          key: "whatsapp",
          label: "WhatsApp Messaging",
          provider: health.provider,
          status: health.status,
          configured: health.configured,
          checkedAt: health.checkedAt,
          missingConfig: health.missingConfig,
          lastError: health.lastError
        })
    )
  ]);

  return [zoho, email, aiHealth(), semrushHealth(), messaging, voice, calendar];
}

function workDetail(event: {
  eventType: string;
  aggregateType: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}): string {
  if (event.lastErrorMessage) return event.lastErrorMessage;
  if (event.lastErrorCode) return event.lastErrorCode;
  return `${event.eventType} for ${event.aggregateType}`;
}

async function getWorkSummary(): Promise<OperationsDashboardDto["work"]> {
  const [groups, recent] = await Promise.all([
    prisma.domainEventOutbox.groupBy({
      by: ["status"],
      _count: { _all: true }
    }),
    prisma.domainEventOutbox.findMany({
      where: { status: { in: ["FAILED", "ATTENTION_REQUIRED", "QUEUED", "PROCESSING"] } },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 12
    })
  ]);

  const statusCounts = groups.map((group) => ({
    status: group.status,
    count: group._count._all
  }));
  const countFor = (status: string): number =>
    statusCounts.find((item) => item.status === status)?.count ?? 0;

  return {
    statusCounts,
    queuedCount: countFor("QUEUED"),
    failedCount: countFor("FAILED"),
    attentionRequiredCount: countFor("ATTENTION_REQUIRED"),
    recentProblemItems: recent.map(
      (event): OperationsWorkItemDto => ({
        id: event.id,
        type: event.eventType,
        status: event.status,
        detail: workDetail(event),
        occurredAt: event.updatedAt.toISOString()
      })
    )
  };
}

async function getUnsyncedRecords(): Promise<OperationsDashboardDto["unsyncedRecords"]> {
  const groups = await prisma.externalRecordMapping.groupBy({
    by: ["provider", "syncStatus"],
    where: { syncStatus: { not: "SYNCED" } },
    _count: { _all: true }
  });

  return {
    total: groups.reduce((sum, group) => sum + group._count._all, 0),
    byStatus: groups.map((group) => ({
      provider: group.provider,
      status: group.syncStatus,
      count: group._count._all
    }))
  };
}

function providerError(input: {
  id: string;
  provider: string;
  source: string;
  status: string;
  message: string | null;
  occurredAt: Date;
}): OperationsProviderErrorDto {
  return {
    id: input.id,
    provider: input.provider,
    source: input.source,
    status: input.status,
    message: input.message ?? "Provider operation requires attention",
    occurredAt: input.occurredAt.toISOString()
  };
}

async function getProviderErrors(): Promise<OperationsProviderErrorDto[]> {
  const [
    syncRuns,
    mappings,
    events,
    outboundEmails,
    voiceCalls,
    whatsappMessages,
    meetingRequests,
    proposals
  ] = await Promise.all([
    prisma.integrationSyncRun.findMany({
      where: { OR: [{ status: { in: ["FAILED", "PARTIAL"] } }, { lastError: { not: null } }] },
      orderBy: { updatedAt: "desc" },
      take: 10
    }),
    prisma.externalRecordMapping.findMany({
      where: {
        OR: [{ syncStatus: { in: ["FAILED", "CONFLICT"] } }, { lastErrorMessage: { not: null } }]
      },
      orderBy: { updatedAt: "desc" },
      take: 10
    }),
    prisma.domainEventOutbox.findMany({
      where: { status: { in: ["FAILED", "ATTENTION_REQUIRED"] } },
      orderBy: { updatedAt: "desc" },
      take: 10
    }),
    prisma.outboundEmail.findMany({
      where: { status: { in: ["BLOCKED", "BOUNCED", "COMPLAINED", "FAILED"] } },
      orderBy: { updatedAt: "desc" },
      take: 10
    }),
    prisma.voiceCallAttempt.findMany({
      where: { status: { in: ["FAILED", "BLOCKED", "NOT_CONFIGURED"] } },
      orderBy: { updatedAt: "desc" },
      take: 10
    }),
    prisma.outboundWhatsAppMessage.findMany({
      where: { status: { in: ["FAILED", "BLOCKED", "NOT_CONFIGURED"] } },
      orderBy: { updatedAt: "desc" },
      take: 10
    }),
    prisma.meetingRequest.findMany({
      where: {
        OR: [
          { status: "ATTENTION_REQUIRED" },
          { providerSyncStatus: { in: ["FAILED", "NOT_CONFIGURED"] } },
          { zohoSyncStatus: { in: ["FAILED", "NOT_CONFIGURED"] } }
        ]
      },
      orderBy: { updatedAt: "desc" },
      take: 10
    }),
    prisma.proposal.findMany({
      where: { zohoTimelineSyncStatus: { in: ["FAILED", "NOT_CONFIGURED"] } },
      orderBy: { updatedAt: "desc" },
      take: 10
    })
  ]);

  return [
    ...syncRuns.map((run) =>
      providerError({
        id: run.id,
        provider: run.provider,
        source: `Integration sync: ${run.operation}`,
        status: run.status,
        message: run.lastError,
        occurredAt: run.updatedAt
      })
    ),
    ...mappings.map((mapping) =>
      providerError({
        id: mapping.id,
        provider: mapping.provider,
        source: `Mapping: ${mapping.entityType}`,
        status: mapping.syncStatus,
        message: mapping.lastErrorMessage ?? mapping.lastErrorCode,
        occurredAt: mapping.updatedAt
      })
    ),
    ...events.map((event) =>
      providerError({
        id: event.id,
        provider: "WORKER",
        source: `Domain event: ${event.eventType}`,
        status: event.status,
        message: event.lastErrorMessage ?? event.lastErrorCode,
        occurredAt: event.updatedAt
      })
    ),
    ...outboundEmails.map((email) =>
      providerError({
        id: email.id,
        provider: email.provider,
        source: "Outbound email",
        status: email.status,
        message: email.failureMessage ?? email.failureCode,
        occurredAt: email.updatedAt
      })
    ),
    ...voiceCalls.map((call) =>
      providerError({
        id: call.id,
        provider: call.provider,
        source: "Voice call",
        status: call.status,
        message: call.failureMessage ?? call.failureCode,
        occurredAt: call.updatedAt
      })
    ),
    ...whatsappMessages.map((message) =>
      providerError({
        id: message.id,
        provider: message.provider,
        source: "WhatsApp message",
        status: message.status,
        message: message.failureMessage ?? message.failureCode,
        occurredAt: message.updatedAt
      })
    ),
    ...meetingRequests.map((meeting) =>
      providerError({
        id: meeting.id,
        provider: meeting.provider,
        source: "Meeting request",
        status: meeting.status,
        message: meeting.providerLastError ?? meeting.zohoLastError,
        occurredAt: meeting.updatedAt
      })
    ),
    ...proposals.map((proposal) =>
      providerError({
        id: proposal.id,
        provider: "ZOHO_BIGIN",
        source: "Proposal timeline sync",
        status: proposal.zohoTimelineSyncStatus,
        message: proposal.zohoTimelineLastError,
        occurredAt: proposal.updatedAt
      })
    )
  ]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, 20);
}

function usageIndicator(input: {
  key: string;
  label: string;
  provider: string;
  count: number;
  unit: string;
  period?: "ALL_TIME" | "LAST_24_HOURS";
}): OperationsUsageIndicatorDto {
  return {
    key: input.key,
    label: input.label,
    provider: input.provider,
    count: input.count,
    unit: input.unit,
    period: input.period ?? "ALL_TIME",
    costAmount: null,
    currency: null,
    costUnavailableReason: "No provider billing feed or token-cost evidence is persisted for R28"
  };
}

async function getUsageIndicators(): Promise<OperationsUsageIndicatorDto[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    sentEmails,
    emailEvents,
    voiceCalls,
    whatsappMessages,
    whatsappEvents,
    aiProposalRuns,
    replyRuns,
    briefingRuns,
    meetingConfirmations
  ] = await Promise.all([
    prisma.outboundEmail.count({ where: { status: { in: ["SENT", "DELIVERED"] } } }),
    prisma.emailProviderEvent.count({ where: { receivedAt: { gte: since } } }),
    prisma.voiceCallAttempt.count(),
    prisma.outboundWhatsAppMessage.count(),
    prisma.whatsAppProviderEvent.count({ where: { receivedAt: { gte: since } } }),
    prisma.proposalGenerationRun.count(),
    prisma.replyProcessingRun.count(),
    prisma.briefingRun.count(),
    prisma.meetingRequest.count({ where: { status: "CONFIRMED" } })
  ]);

  return [
    usageIndicator({
      key: "email-sent",
      label: "Provider-confirmed sent emails",
      provider: "EMAIL",
      count: sentEmails,
      unit: "emails"
    }),
    usageIndicator({
      key: "email-events-24h",
      label: "Email provider events",
      provider: "EMAIL",
      count: emailEvents,
      unit: "events",
      period: "LAST_24_HOURS"
    }),
    usageIndicator({
      key: "voice-calls",
      label: "Voice call attempts",
      provider: "TWILIO",
      count: voiceCalls,
      unit: "calls"
    }),
    usageIndicator({
      key: "whatsapp-outbound",
      label: "Outbound WhatsApp messages",
      provider: "META_WHATSAPP",
      count: whatsappMessages,
      unit: "messages"
    }),
    usageIndicator({
      key: "whatsapp-events-24h",
      label: "WhatsApp provider events",
      provider: "META_WHATSAPP",
      count: whatsappEvents,
      unit: "events",
      period: "LAST_24_HOURS"
    }),
    usageIndicator({
      key: "ai-runs",
      label: "Persisted AI generation/understanding runs",
      provider: "AI",
      count: aiProposalRuns + replyRuns + briefingRuns,
      unit: "runs"
    }),
    usageIndicator({
      key: "meeting-confirmations",
      label: "Confirmed calendar meetings",
      provider: "GOOGLE_CALENDAR",
      count: meetingConfirmations,
      unit: "meetings"
    })
  ];
}

export async function getOperationsDashboard(): Promise<OperationsDashboardDto> {
  const [providerHealth, work, unsyncedRecords, providerErrors, usage] = await Promise.all([
    getProviderHealth(),
    getWorkSummary(),
    getUnsyncedRecords(),
    getProviderErrors(),
    getUsageIndicators()
  ]);

  return {
    generatedAt: new Date().toISOString(),
    providerHealth,
    work,
    unsyncedRecords,
    providerErrors,
    usage
  };
}
