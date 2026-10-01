import crypto from "node:crypto";
import {
  IntegrationAccountStatus,
  Prisma,
  UserRole,
  VoiceCallStatus
} from "@prisma/client";
import { getVoiceConfig, type VoiceConfig } from "@shilabs/shared-config";
import type {
  IntegrationHealthDto,
  VoiceCallAttemptDto,
  VoiceWebhookResultDto
} from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { redactSecrets } from "../../shared/redaction.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import {
  upsertExternalRecordMapping,
  upsertIntegrationAccount
} from "../integrations/integration-mapping.repository.js";
import { toLeadDto } from "../leads/lead.service.js";
import { createVoiceProvider, type VoiceProvider } from "./voice.provider.js";
import type {
  ExotelStatusWebhookInput,
  ManualVoiceCallInput,
  TwilioRecordingWebhookInput,
  TwilioStatusWebhookInput
} from "./voice.schemas.js";

const voiceCallInclude = {
  lead: { include: { company: true, contact: true, owner: true, stage: true } }
} satisfies Prisma.VoiceCallAttemptInclude;

type VoiceCallRecord = Prisma.VoiceCallAttemptGetPayload<{ include: typeof voiceCallInclude }>;

interface VoiceServiceOptions {
  env?: NodeJS.ProcessEnv;
  provider?: VoiceProvider;
}

function displayVoiceProvider(config: VoiceConfig): "TWILIO" | "EXOTEL" {
  return config.provider === "exotel" ? "EXOTEL" : "TWILIO";
}

function voiceSecretRef(config: VoiceConfig): string | null {
  if (config.provider === "twilio") return "env:TWILIO_AUTH_TOKEN";
  if (config.provider === "exotel") return "env:EXOTEL_API_TOKEN";
  return null;
}

function voicePublicConfig(config: VoiceConfig): Prisma.InputJsonObject {
  return {
    webhookBaseUrlConfigured: Boolean(config.webhookBaseUrl),
    fromNumberConfigured: Boolean(providerFromNumber(config)),
    defaultRegion: config.defaultRegion,
    defaultAccent: config.defaultAccent,
    recordingEnabled: config.recordingEnabled,
    transcriptionEnabled: config.transcriptionEnabled,
    productionCallingEnabled: config.productionCallingEnabled,
    complianceConsentMode: config.complianceConsentMode
  };
}

function missingVoiceConfig(config: VoiceConfig): string[] {
  if (config.provider === "none") {
    return ["VOICE_PROVIDER"];
  }

  const missing: string[] = [];
  if (config.provider === "twilio") {
    if (!config.twilio.accountSid) missing.push("TWILIO_ACCOUNT_SID");
    if (!config.twilio.authToken) missing.push("TWILIO_AUTH_TOKEN");
    if (!config.twilio.fromNumber) missing.push("TWILIO_FROM_NUMBER");
  } else {
    if (!config.exotel.accountSid) missing.push("EXOTEL_ACCOUNT_SID");
    if (!config.exotel.apiKey) missing.push("EXOTEL_API_KEY");
    if (!config.exotel.apiToken) missing.push("EXOTEL_API_TOKEN");
    if (!config.exotel.apiSubdomain) missing.push("EXOTEL_API_SUBDOMAIN");
    if (!config.exotel.callerId) missing.push("EXOTEL_CALLER_ID");
    if (!config.exotel.appUrl && !config.exotel.agentNumber && !config.voiceAi.enabled) {
      missing.push("EXOTEL_APP_URL_OR_AGENT_NUMBER_OR_VOICE_AI_ENABLED");
    }
    if (config.voiceAi.enabled && !config.voiceAi.streamToken) {
      missing.push("VOICE_AI_STREAM_TOKEN");
    }
  }
  if (!config.webhookBaseUrl) missing.push("VOICE_WEBHOOK_BASE_URL");
  return missing;
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return redactSecrets(error.message).slice(0, 500);
  }

  return "Voice provider request failed";
}

function toIntegrationHealthDto(input: {
  config: VoiceConfig;
  status: IntegrationAccountStatus;
  accountId: string | null;
  checkedAt: Date;
  missingConfig: string[];
  lastError: string | null;
}): IntegrationHealthDto {
  return {
    provider: displayVoiceProvider(input.config),
    status: input.status,
    configured: input.status === "CONFIGURED",
    checkedAt: input.checkedAt.toISOString(),
    accountId: input.accountId,
    apiDomain:
      input.config.provider === "exotel"
        ? `https://${input.config.exotel.apiSubdomain || "api.exotel.com"}`
        : "https://api.twilio.com",
    accountsUrl: null,
    missingConfig: input.missingConfig,
    scopes: [],
    tokenExpiresAt: null,
    lastError: input.lastError
  };
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[()\s.-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function canAccessLead(actor: AuthenticatedUser, lead: { ownerId: string | null }): boolean {
  return (
    actor.role === UserRole.ADMIN ||
    actor.role === UserRole.SALES_MANAGER ||
    lead.ownerId === actor.id
  );
}

function isTerminalLead(status: string): boolean {
  return status === "WON" || status === "LOST" || status === "DISQUALIFIED";
}

function twilioCallStatus(status: string): VoiceCallStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "initiated" || normalized === "queued") return "QUEUED";
  if (normalized === "ringing") return "RINGING";
  if (normalized === "answered" || normalized === "in-progress") return "IN_PROGRESS";
  if (normalized === "completed") return "COMPLETED";
  if (normalized === "busy") return "BUSY";
  if (normalized === "no-answer") return "NO_ANSWER";
  if (normalized === "canceled" || normalized === "cancelled") return "CANCELED";
  if (normalized === "failed") return "FAILED";
  return "FAILED";
}

function providerFromNumber(config: VoiceConfig): string {
  return config.provider === "exotel" ? config.exotel.callerId : config.twilio.fromNumber;
}

function providerDisplayName(config: VoiceConfig): "Twilio" | "Exotel" {
  return config.provider === "exotel" ? "Exotel" : "Twilio";
}

function providerCallStatus(status: string | null): VoiceCallStatus {
  const normalized = (status ?? "queued").trim().toLowerCase();
  if (["queued", "initiated", "in-progress", "active"].includes(normalized)) return "QUEUED";
  if (normalized === "ringing") return "RINGING";
  if (normalized === "answered") return "IN_PROGRESS";
  return twilioCallStatus(status ?? "failed");
}

function exotelCallStatus(status: string): VoiceCallStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "queued" || normalized === "initiated") return "QUEUED";
  if (normalized === "ringing") return "RINGING";
  if (normalized === "answered" || normalized === "in-progress" || normalized === "active") {
    return "IN_PROGRESS";
  }
  if (normalized === "completed") return "COMPLETED";
  if (normalized === "busy") return "BUSY";
  if (normalized === "no-answer" || normalized === "noanswer") return "NO_ANSWER";
  if (normalized === "canceled" || normalized === "cancelled") return "CANCELED";
  if (normalized === "failed") return "FAILED";
  return "FAILED";
}

function isTerminalCallStatus(status: VoiceCallStatus): boolean {
  return ["COMPLETED", "BUSY", "NO_ANSWER", "FAILED", "CANCELED"].includes(status);
}

function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 0 ? duration : null;
}

function webhookEventId(prefix: string, providerCallId: string, body: Record<string, string>): string {
  const stable =
    body.SequenceNumber ??
    body.RecordingSid ??
    crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 24);
  return `${prefix}:${providerCallId}:${stable}`;
}

function webhookUrl(config: VoiceConfig, path: string): string {
  return `${config.webhookBaseUrl.replace(/\/$/, "")}${path}`;
}

function bodyAsStringRecord(body: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, typeof value === "string" ? value : String(value)])
  );
}

export function toVoiceCallAttemptDto(call: VoiceCallRecord): VoiceCallAttemptDto {
  return {
    id: call.id,
    leadId: call.leadId,
    contactId: call.contactId,
    actorUserId: call.actorUserId,
    provider: call.provider,
    direction: call.direction,
    toPhone: call.toPhone,
    fromPhone: call.fromPhone,
    providerCallId: call.providerCallId,
    status: call.status,
    regionalVoice: call.regionalVoice,
    accent: call.accent,
    recordingEnabled: call.recordingEnabled,
    transcriptionEnabled: call.transcriptionEnabled,
    recordingStatus: call.recordingStatus,
    recordingProviderId: call.recordingProviderId,
    recordingUrl: call.recordingUrl,
    transcriptStatus: call.transcriptStatus,
    transcriptProviderId: call.transcriptProviderId,
    transcriptUrl: call.transcriptUrl,
    transcriptText: call.transcriptText,
    durationSeconds: call.durationSeconds,
    failureCode: call.failureCode,
    failureMessage: call.failureMessage,
    idempotencyKey: call.idempotencyKey,
    requestedAt: call.requestedAt.toISOString(),
    providerAcceptedAt: call.providerAcceptedAt?.toISOString() ?? null,
    answeredAt: call.answeredAt?.toISOString() ?? null,
    completedAt: call.completedAt?.toISOString() ?? null,
    createdAt: call.createdAt.toISOString(),
    updatedAt: call.updatedAt.toISOString(),
    lead: toLeadDto(call.lead)
  };
}

export async function getVoiceHealth(options?: VoiceServiceOptions): Promise<IntegrationHealthDto> {
  const checkedAt = new Date();
  const config = getVoiceConfig(options?.env);
  const missingConfig = missingVoiceConfig(config);
  const provider = displayVoiceProvider(config);
  const displayName = `${providerDisplayName(config)} Voice`;
  if (missingConfig.length > 0) {
    const account = await upsertIntegrationAccount({
      provider,
      key: "default",
      displayName,
      status: "NOT_CONFIGURED",
      secretRef: voiceSecretRef(config),
      publicConfig: voicePublicConfig(config),
      lastCheckedAt: checkedAt,
      lastError: `Missing configuration: ${missingConfig.join(", ")}`
    });
    return toIntegrationHealthDto({
      config,
      status: "NOT_CONFIGURED",
      accountId: account.id,
      checkedAt,
      missingConfig,
      lastError: account.lastError
    });
  }

  try {
    const voiceProvider = options?.provider ?? createVoiceProvider(config);
    const health = await voiceProvider.getHealth();
    const status = health.status === "CONFIGURED" ? "CONFIGURED" : "ERROR";
    const account = await upsertIntegrationAccount({
      provider,
      key: "default",
      displayName,
      status,
      secretRef: voiceSecretRef(config),
      publicConfig: voicePublicConfig(config),
      lastCheckedAt: checkedAt,
      lastError: health.lastError
    });
    return toIntegrationHealthDto({
      config,
      status,
      accountId: account.id,
      checkedAt,
      missingConfig: [],
      lastError: account.lastError
    });
  } catch (error) {
    const lastError = sanitizeError(error);
    const account = await upsertIntegrationAccount({
      provider,
      key: "default",
      displayName,
      status: "ERROR",
      secretRef: voiceSecretRef(config),
      publicConfig: voicePublicConfig(config),
      lastCheckedAt: checkedAt,
      lastError
    });
    return toIntegrationHealthDto({
      config,
      status: "ERROR",
      accountId: account.id,
      checkedAt,
      missingConfig: [],
      lastError
    });
  }
}

async function markCallBlocked(input: {
  callId: string;
  actorId: string;
  leadId: string;
  code: string;
  message: string;
}): Promise<VoiceCallRecord> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.voiceCallAttempt.update({
      where: { id: input.callId },
      data: {
        status: input.code === "VOICE_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "BLOCKED",
        failureCode: input.code,
        failureMessage: input.message,
        completedAt: now
      },
      include: voiceCallInclude
    });
    await tx.activity.create({
      data: {
        leadId: input.leadId,
        actorUserId: input.actorId,
        type: "CALL_FAILED",
        description: `Voice call blocked: ${input.message}`
      }
    });
    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        actorId: input.actorId,
        entityType: "VoiceCallAttempt",
        entityId: input.callId,
        action: "VOICE_CALL_BLOCKED",
        after: { leadId: input.leadId, code: input.code, message: input.message }
      }
    });
    await publishDomainEvent({
      client: tx,
      eventType: "CALL_FAILED",
      aggregateType: "VoiceCallAttempt",
      aggregateId: input.callId,
      idempotencyKey: `domain-event:voice-call-failed:${input.callId}:${input.code}`,
      payload: { leadId: input.leadId, code: input.code }
    });
    return updated;
  });
}

export async function createManualVoiceCall(
  actor: AuthenticatedUser,
  input: ManualVoiceCallInput,
  options?: VoiceServiceOptions
): Promise<VoiceCallAttemptDto> {
  const existing = await prisma.voiceCallAttempt.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: voiceCallInclude
  });
  if (existing) return toVoiceCallAttemptDto(existing);

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    include: { company: true, contact: true, owner: true, stage: true }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (!canAccessLead(actor, lead)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot call for this lead");
  }

  const config = getVoiceConfig(options?.env);
  const normalizedToPhone = normalizePhone(lead.contact.phone);
  const configuredFromPhone = providerFromNumber(config);
  const normalizedFromPhone =
    config.provider === "twilio" ? normalizePhone(configuredFromPhone) : configuredFromPhone.trim();
  const provider = displayVoiceProvider(config);
  const providerName = providerDisplayName(config);
  const created = await prisma.voiceCallAttempt.create({
    data: {
      leadId: lead.id,
      contactId: lead.contactId,
      actorUserId: actor.id,
      provider,
      toPhone: lead.contact.phone ?? "",
      normalizedToPhone: normalizedToPhone ?? "",
      fromPhone: configuredFromPhone || "not-configured",
      status: "REQUESTED",
      regionalVoice: input.regionalVoice ?? config.defaultRegion,
      accent: input.accent ?? config.defaultAccent,
      recordingEnabled: config.recordingEnabled,
      transcriptionEnabled: config.transcriptionEnabled,
      recordingStatus: config.recordingEnabled ? "PENDING" : "DISABLED",
      transcriptStatus: config.transcriptionEnabled ? "PENDING" : "DISABLED",
      idempotencyKey: input.idempotencyKey
    },
    include: voiceCallInclude
  });

  const block = (() => {
    if (!normalizedToPhone) return { code: "CONTACT_PHONE_MISSING", message: "Contact phone is not usable" };
    if (!normalizedFromPhone) {
      return { code: "VOICE_FROM_PHONE_MISSING", message: `${providerName} from number is not usable` };
    }
    if (lead.contact.doNotContact) return { code: "CONTACT_DO_NOT_CONTACT", message: "Contact is marked do-not-contact" };
    if (isTerminalLead(lead.status)) return { code: "TERMINAL_LEAD", message: "Lead is terminal or disqualified" };
    if (config.nodeEnv === "production" && !config.productionCallingEnabled) {
      return { code: "PRODUCTION_CALLING_DISABLED", message: "Production voice calling is disabled" };
    }
    if (config.nodeEnv === "production" && config.complianceConsentMode !== "confirmed") {
      return { code: "VOICE_CONSENT_NOT_CONFIRMED", message: "Production calling consent/compliance is not confirmed" };
    }
    if (
      config.nodeEnv !== "production" &&
      config.e2eAllowedToNumbers.length > 0 &&
      !config.e2eAllowedToNumbers.includes(normalizedToPhone)
    ) {
      return { code: "E2E_NUMBER_NOT_ALLOWED", message: "Destination number is not allowed for local E2E voice testing" };
    }
    if (config.recordingEnabled && config.complianceConsentMode === "disabled") {
      return { code: "RECORDING_CONSENT_NOT_CONFIGURED", message: "Recording requires explicit consent configuration" };
    }
    return null;
  })();
  if (block) {
    return toVoiceCallAttemptDto(
      await markCallBlocked({
        callId: created.id,
        actorId: actor.id,
        leadId: lead.id,
        code: block.code,
        message: block.message
      })
    );
  }

  if (missingVoiceConfig(config).length > 0) {
    return toVoiceCallAttemptDto(
      await markCallBlocked({
        callId: created.id,
        actorId: actor.id,
        leadId: lead.id,
        code: "VOICE_NOT_CONFIGURED",
        message: `Missing configuration: ${missingVoiceConfig(config).join(", ")}`
      })
    );
  }
  if (!normalizedToPhone || !normalizedFromPhone) {
    throw new AppError(409, "CONFLICT", "Voice call phone normalization failed");
  }

  await prisma.voiceCallAttempt.update({
    where: { id: created.id },
    data: { status: "PROVIDER_PENDING" }
  });

  const voiceProvider = options?.provider ?? createVoiceProvider(config);
  const result = await voiceProvider.createOutboundCall({
    to: normalizedToPhone,
    from: normalizedFromPhone,
    twimlUrl: `${config.webhookBaseUrl.replace(/\/$/, "")}/api/voice/twilio/twiml/test-call?attemptId=${created.id}`,
    statusCallbackUrl: webhookUrl(
      config,
      config.provider === "exotel" ? config.exotel.statusCallbackPath : config.twilio.statusCallbackPath
    ),
    recordingCallbackUrl: config.recordingEnabled
      ? webhookUrl(config, config.twilio.recordingCallbackPath)
      : null,
    recordingEnabled: config.recordingEnabled,
    transcriptionEnabled: config.transcriptionEnabled,
    idempotencyKey: input.idempotencyKey
  });

  if (result.status !== "ACCEPTED" || !result.providerCallId) {
    return toVoiceCallAttemptDto(
      await markCallBlocked({
        callId: created.id,
        actorId: actor.id,
        leadId: lead.id,
        code: result.status === "NOT_CONFIGURED" ? "VOICE_NOT_CONFIGURED" : "VOICE_PROVIDER_ERROR",
        message: result.lastError ?? "Voice provider did not accept the call"
      })
    );
  }

  const now = new Date();
  const accepted = await prisma.$transaction(async (tx) => {
    const updated = await tx.voiceCallAttempt.update({
      where: { id: created.id },
      data: {
        providerCallId: result.providerCallId,
        status: providerCallStatus(result.providerStatus ?? "queued"),
        providerAcceptedAt: now,
        failureCode: null,
        failureMessage: null
      },
      include: voiceCallInclude
    });
    await tx.activity.create({
      data: {
        leadId: lead.id,
        actorUserId: actor.id,
        type: "CALL_REQUESTED",
        description: `Manual R22 voice test call accepted by ${providerName}`
      }
    });
    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        actorId: actor.id,
        entityType: "VoiceCallAttempt",
        entityId: created.id,
        action: "VOICE_CALL_REQUESTED",
        after: {
          leadId: lead.id,
          provider,
          providerCallId: result.providerCallId,
          recordingEnabled: config.recordingEnabled,
          transcriptionEnabled: config.transcriptionEnabled
        }
      }
    });
    await publishDomainEvent({
      client: tx,
      eventType: "CALL_REQUESTED",
      aggregateType: "VoiceCallAttempt",
      aggregateId: created.id,
      idempotencyKey: `domain-event:voice-call-requested:${created.id}`,
      payload: { leadId: lead.id, providerCallId: result.providerCallId }
    });
    return updated;
  });

  await upsertExternalRecordMapping({
    provider,
    entityType: "CALL",
    localEntityId: accepted.id,
    externalRecordId: result.providerCallId,
    syncDirection: "OUTBOUND",
    syncStatus: "SYNCED",
    lastSyncedAt: now,
    idempotencyKey: `${config.provider}:call:${accepted.id}`
  });

  return toVoiceCallAttemptDto(accepted);
}

function verifyTwilioWebhook(input: {
  config: VoiceConfig;
  provider?: VoiceProvider;
  callbackPath: string;
  body: Record<string, string>;
  signature?: string;
}): void {
  if (missingVoiceConfig(input.config).length > 0) {
    throw new AppError(503, "PROVIDER_ERROR", "Twilio voice webhook is not configured");
  }
  const provider = input.provider ?? createVoiceProvider(input.config);
  const url = webhookUrl(input.config, input.callbackPath);
  if (!provider.verifyWebhook({ url, params: input.body, signature: input.signature })) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Twilio webhook signature is invalid");
  }
}

export async function ingestTwilioStatusWebhook(input: {
  body: TwilioStatusWebhookInput;
  signature?: string;
  env?: NodeJS.ProcessEnv;
  provider?: VoiceProvider;
}): Promise<VoiceWebhookResultDto> {
  const config = getVoiceConfig(input.env);
  const body = bodyAsStringRecord(input.body);
  verifyTwilioWebhook({
    config,
    provider: input.provider,
    callbackPath: config.twilio.statusCallbackPath,
    body,
    signature: input.signature
  });
  const eventId = webhookEventId("twilio-status", input.body.CallSid, body);
  const duplicate = await prisma.voiceProviderEvent.findUnique({
    where: { provider_providerEventId: { provider: "TWILIO", providerEventId: eventId } }
  });
  if (duplicate) {
    return {
      provider: "TWILIO",
      status: "DUPLICATE",
      eventId,
      callAttemptId: duplicate.callAttemptId,
      callStatus: null
    };
  }

  const call = await prisma.voiceCallAttempt.findUnique({
    where: { providerCallId: input.body.CallSid }
  });
  const status = twilioCallStatus(input.body.CallStatus);
  const durationSeconds = parseDuration(input.body.CallDuration);
  const now = new Date();

  const event = await prisma.$transaction(async (tx) => {
    const createdEvent = await tx.voiceProviderEvent.create({
      data: {
        provider: "TWILIO",
        providerEventId: eventId,
        providerCallId: input.body.CallSid,
        callAttemptId: call?.id,
        type: "CALL_STATUS",
        payload: body,
        processedAt: now
      }
    });
    if (call) {
      await tx.voiceCallAttempt.update({
        where: { id: call.id },
        data: {
          status,
          durationSeconds: durationSeconds ?? undefined,
          answeredAt: status === "IN_PROGRESS" ? now : undefined,
          completedAt: isTerminalCallStatus(status) ? now : undefined,
          failureCode: ["FAILED", "BUSY", "NO_ANSWER", "CANCELED"].includes(status)
            ? `TWILIO_${status}`
            : undefined,
          failureMessage: ["FAILED", "BUSY", "NO_ANSWER", "CANCELED"].includes(status)
            ? `Twilio call status: ${input.body.CallStatus}`
            : undefined
        }
      });
      if (isTerminalCallStatus(status)) {
        await tx.callingAttempt.updateMany({
          where: { voiceCallAttemptId: call.id },
          data: {
            status: status === "COMPLETED" ? "COMPLETED" : "FAILED",
            completedAt: now,
            failureCode: status === "COMPLETED" ? null : `TWILIO_${status}`,
            failureMessage:
              status === "COMPLETED" ? null : `Twilio call status: ${input.body.CallStatus}`
          }
        });
      }
      await tx.activity.create({
        data: {
          leadId: call.leadId,
          type: status === "FAILED" ? "CALL_FAILED" : "CALL_STATUS_UPDATED",
          description: `Twilio call status: ${input.body.CallStatus}`
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          entityType: "VoiceCallAttempt",
          entityId: call.id,
          action: "VOICE_CALL_STATUS_UPDATED",
          after: { providerCallId: input.body.CallSid, status }
        }
      });
      await publishDomainEvent({
        client: tx,
        eventType: "CALL_STATUS_UPDATED",
        aggregateType: "VoiceCallAttempt",
        aggregateId: call.id,
        idempotencyKey: `domain-event:voice-call-status:${createdEvent.id}`,
        payload: { providerCallId: input.body.CallSid, status }
      });
    }
    return createdEvent;
  });

  return {
    provider: "TWILIO",
    status: "PROCESSED",
    eventId,
    callAttemptId: event.callAttemptId,
    callStatus: status
  };
}

export async function ingestTwilioRecordingWebhook(input: {
  body: TwilioRecordingWebhookInput;
  signature?: string;
  env?: NodeJS.ProcessEnv;
  provider?: VoiceProvider;
}): Promise<VoiceWebhookResultDto> {
  const config = getVoiceConfig(input.env);
  const body = bodyAsStringRecord(input.body);
  verifyTwilioWebhook({
    config,
    provider: input.provider,
    callbackPath: config.twilio.recordingCallbackPath,
    body,
    signature: input.signature
  });
  const eventId = webhookEventId("twilio-recording", input.body.CallSid, body);
  const duplicate = await prisma.voiceProviderEvent.findUnique({
    where: { provider_providerEventId: { provider: "TWILIO", providerEventId: eventId } }
  });
  if (duplicate) {
    return {
      provider: "TWILIO",
      status: "DUPLICATE",
      eventId,
      callAttemptId: duplicate.callAttemptId,
      callStatus: null
    };
  }

  const call = await prisma.voiceCallAttempt.findUnique({
    where: { providerCallId: input.body.CallSid }
  });
  const now = new Date();
  const recordingStatus =
    input.body.RecordingStatus.toLowerCase() === "completed" ? "AVAILABLE" : "FAILED";
  const event = await prisma.$transaction(async (tx) => {
    const createdEvent = await tx.voiceProviderEvent.create({
      data: {
        provider: "TWILIO",
        providerEventId: eventId,
        providerCallId: input.body.CallSid,
        callAttemptId: call?.id,
        type: "RECORDING_STATUS",
        payload: body,
        processedAt: now
      }
    });
    if (call) {
      await tx.voiceCallAttempt.update({
        where: { id: call.id },
        data: {
          recordingStatus,
          recordingProviderId: input.body.RecordingSid,
          recordingUrl: config.recordingEnabled ? (input.body.RecordingUrl ?? null) : null,
          durationSeconds: parseDuration(input.body.RecordingDuration) ?? undefined
        }
      });
    }
    return createdEvent;
  });

  return {
    provider: "TWILIO",
    status: "PROCESSED",
    eventId,
    callAttemptId: event.callAttemptId,
    callStatus: null
  };
}

function exotelProviderCallId(body: ExotelStatusWebhookInput): string {
  return (body.CallSid ?? body.Sid ?? "").trim();
}

function exotelProviderStatus(body: ExotelStatusWebhookInput): string {
  return (body.CallStatus ?? body.Status ?? "").trim();
}

export async function ingestExotelStatusWebhook(input: {
  body: ExotelStatusWebhookInput;
}): Promise<VoiceWebhookResultDto> {
  const body = bodyAsStringRecord(input.body);
  const providerCallId = exotelProviderCallId(input.body);
  const providerStatus = exotelProviderStatus(input.body);
  const status = exotelCallStatus(providerStatus);
  const eventId = webhookEventId("exotel-status", providerCallId, body);
  const duplicate = await prisma.voiceProviderEvent.findUnique({
    where: { provider_providerEventId: { provider: "EXOTEL", providerEventId: eventId } }
  });
  if (duplicate) {
    return {
      provider: "EXOTEL",
      status: "DUPLICATE",
      eventId,
      callAttemptId: duplicate.callAttemptId,
      callStatus: null
    };
  }

  const call = await prisma.voiceCallAttempt.findUnique({
    where: { providerCallId }
  });
  const durationSeconds = parseDuration(input.body.CallDuration ?? input.body.Duration);
  const now = new Date();
  const event = await prisma.$transaction(async (tx) => {
    const createdEvent = await tx.voiceProviderEvent.create({
      data: {
        provider: "EXOTEL",
        providerEventId: eventId,
        providerCallId,
        callAttemptId: call?.id,
        type: "CALL_STATUS",
        payload: body,
        processedAt: now
      }
    });
    if (call) {
      await tx.voiceCallAttempt.update({
        where: { id: call.id },
        data: {
          status,
          durationSeconds: durationSeconds ?? undefined,
          answeredAt: status === "IN_PROGRESS" ? (call.answeredAt ?? now) : undefined,
          completedAt: isTerminalCallStatus(status) ? now : undefined,
          failureCode: ["FAILED", "BUSY", "NO_ANSWER", "CANCELED"].includes(status)
            ? `EXOTEL_${status}`
            : undefined,
          failureMessage: ["FAILED", "BUSY", "NO_ANSWER", "CANCELED"].includes(status)
            ? `Exotel call status: ${providerStatus}`
            : undefined
        }
      });
      if (isTerminalCallStatus(status)) {
        await tx.callingAttempt.updateMany({
          where: { voiceCallAttemptId: call.id },
          data: {
            status: status === "COMPLETED" ? "COMPLETED" : "FAILED",
            completedAt: now,
            failureCode: status === "COMPLETED" ? null : `EXOTEL_${status}`,
            failureMessage: status === "COMPLETED" ? null : `Exotel call status: ${providerStatus}`
          }
        });
      }
      await tx.activity.create({
        data: {
          leadId: call.leadId,
          type: status === "FAILED" ? "CALL_FAILED" : "CALL_STATUS_UPDATED",
          description: `Exotel call status: ${providerStatus}`
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          entityType: "VoiceCallAttempt",
          entityId: call.id,
          action: "VOICE_CALL_STATUS_UPDATED",
          after: { providerCallId, status, provider: "EXOTEL" }
        }
      });
      await publishDomainEvent({
        client: tx,
        eventType: "CALL_STATUS_UPDATED",
        aggregateType: "VoiceCallAttempt",
        aggregateId: call.id,
        idempotencyKey: `domain-event:voice-call-status:${createdEvent.id}`,
        payload: { providerCallId, status, provider: "EXOTEL" }
      });
    }
    return createdEvent;
  });

  return {
    provider: "EXOTEL",
    status: "PROCESSED",
    eventId,
    callAttemptId: event.callAttemptId,
    callStatus: status
  };
}

export function buildTwilioTestCallTwiml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    "<Say voice=\"alice\">This is a Shilabs AI Sales Engine local E2E voice test call. No automation sequence has been started.</Say>",
    "</Response>"
  ].join("");
}
