import { Prisma } from "@prisma/client";
import { getMessagingConfig } from "@shilabs/shared-config";
import { prisma } from "../../shared/prisma.js";
import { AppError } from "../../shared/errors.js";
import {
  createMessagingProvider,
  type MessagingHealthDto,
  TwilioWhatsAppProvider,
  type MessagingProvider
} from "./messaging.provider.js";
import {
  processInboundMessageReply,
  type ProcessReplyOptions
} from "../reply-processing/reply-processing.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";

type PersistedWhatsAppProvider = "META_WHATSAPP" | "TWILIO";
type PublicWhatsAppProvider = "META_WHATSAPP" | "TWILIO_WHATSAPP";

interface WebhookStatus {
  id: string;
  status: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

interface WebhookMessage {
  id: string;
  from: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
}

interface NormalizedInboundWhatsAppMessage {
  id: string;
  from: string;
  timestamp?: string;
  type?: string;
  body: string;
}

interface WebhookValue {
  statuses?: WebhookStatus[];
  messages?: WebhookMessage[];
  contacts?: { wa_id?: string }[];
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const normalized = phone.trim().replace(/[()\s.-]/g, "");
  return /^\+?[1-9]\d{7,14}$/u.test(normalized)
    ? normalized.startsWith("+")
      ? normalized
      : `+${normalized}`
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asWebhookValues(body: unknown): WebhookValue[] {
  const root = asRecord(body);
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  return entries.flatMap((entry) => {
    const entryRecord = asRecord(entry);
    const changes = Array.isArray(entryRecord?.changes) ? entryRecord.changes : [];
    return changes.flatMap((change) => {
      const changeRecord = asRecord(change);
      const value = asRecord(changeRecord?.value);
      return value ? [value] : [];
    });
  });
}

function whatsappTimestamp(timestamp: string | undefined): Date {
  if (!timestamp) return new Date();
  const numeric = Number(timestamp);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric * 1000);
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function statusToOutboundStatus(status: string): {
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  dateField: "sentAt" | "deliveredAt" | "readAt" | "failedAt";
} {
  const normalized = status.toLowerCase();
  if (normalized === "delivered") return { status: "DELIVERED", dateField: "deliveredAt" };
  if (normalized === "read") return { status: "READ", dateField: "readAt" };
  if (normalized === "failed") return { status: "FAILED", dateField: "failedAt" };
  return { status: "SENT", dateField: "sentAt" };
}

function statusFailure(status: WebhookStatus): { code: string | null; message: string | null } {
  const first = status.errors?.[0];
  if (!first) return { code: null, message: null };
  return {
    code: first.code ? `META_${String(first.code)}` : "META_WHATSAPP_STATUS_FAILED",
    message: first.error_data?.details ?? first.message ?? first.title ?? "WhatsApp delivery failed"
  };
}

function inboundBody(message: WebhookMessage): string {
  if (message.text?.body?.trim()) return message.text.body.trim();
  return `[Unsupported WhatsApp ${message.type ?? "message"} message]`;
}

function publicProvider(provider: PersistedWhatsAppProvider): PublicWhatsAppProvider {
  return provider === "META_WHATSAPP" ? "META_WHATSAPP" : "TWILIO_WHATSAPP";
}

async function findLeadForInboundWhatsApp(
  waId: string
): Promise<
  | { ok: true; workspaceId: string; leadId: string; contactId: string; conversationId: string | null }
  | { ok: false; code: string; message: string }
> {
  const normalized = normalizePhone(waId);
  const leads = await prisma.lead.findMany({
    where: {
      contact: {
        OR: [
          { whatsappId: waId },
          ...(normalized ? [{ normalizedPhone: normalized }, { phone: normalized }] : [])
        ]
      },
      status: { notIn: ["WON", "LOST", "DISQUALIFIED"] }
    },
    include: { conversations: { where: { channel: "WHATSAPP" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
    take: 2
  });

  if (leads.length === 0) {
    return {
      ok: false,
      code: "LEAD_NOT_FOUND",
      message: "No eligible lead matched WhatsApp sender"
    };
  }
  if (leads.length > 1) {
    return {
      ok: false,
      code: "AMBIGUOUS_LEAD_MATCH",
      message: "Multiple eligible leads matched WhatsApp sender"
    };
  }
  const lead = leads[0];
  if (!lead) {
    return {
      ok: false,
      code: "LEAD_NOT_FOUND",
      message: "No eligible lead matched WhatsApp sender"
    };
  }
  if (!lead.workspaceId) {
    return {
      ok: false,
      code: "WORKSPACE_CONTEXT_MISSING",
      message: "Matched lead has no persisted workspace"
    };
  }
  return {
    ok: true,
    workspaceId: lead.workspaceId,
    leadId: lead.id,
    contactId: lead.contactId,
    conversationId: lead.conversations[0]?.id ?? null
  };
}

async function stopIncompatibleAutomation(
  tx: Prisma.TransactionClient,
  leadId: string,
  workspaceId: string
): Promise<void> {
  const stoppedAt = new Date();
  const activeFollowUps = await tx.followUpSequence.findMany({
    where: { leadId, workspaceId, status: "ACTIVE" },
    include: { attempts: { where: { status: "SCHEDULED" } } }
  });
  for (const sequence of activeFollowUps) {
    await tx.followUpSequence.update({
      where: { id: sequence.id },
      data: { status: "STOPPED", stopReason: "WHATSAPP_REPLY_RECEIVED", stoppedAt }
    });
    await tx.followUpAttempt.updateMany({
      where: { sequenceId: sequence.id, status: "SCHEDULED" },
      data: {
        status: "CANCELLED",
        failedAt: stoppedAt,
        failureCode: "WHATSAPP_REPLY_RECEIVED",
        failureMessage: "WhatsApp reply received before scheduled follow-up executed"
      }
    });
    await tx.domainEventOutbox.updateMany({
      where: { workspaceId, correlationId: sequence.id, status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
      data: {
        status: "ATTENTION_REQUIRED",
        deadLetteredAt: stoppedAt,
        lastErrorCode: "WHATSAPP_REPLY_RECEIVED",
        lastErrorMessage: "WhatsApp reply stopped pending follow-up automation"
      }
    });
  }

  const activeCallingSequences = await tx.callingSequence.findMany({
    where: { leadId, workspaceId, status: "ACTIVE" },
    include: { attempts: { where: { status: "SCHEDULED" } } }
  });
  for (const sequence of activeCallingSequences) {
    await tx.callingSequence.update({
      where: { id: sequence.id },
      data: { status: "STOPPED", stopReason: "WHATSAPP_REPLY_RECEIVED", stoppedAt }
    });
    await tx.callingAttempt.updateMany({
      where: { sequenceId: sequence.id, status: "SCHEDULED" },
      data: {
        status: "SKIPPED",
        completedAt: stoppedAt,
        failureCode: "WHATSAPP_REPLY_RECEIVED",
        failureMessage: "WhatsApp reply received before scheduled call executed"
      }
    });
    await tx.domainEventOutbox.updateMany({
      where: { workspaceId, correlationId: sequence.id, status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
      data: {
        status: "ATTENTION_REQUIRED",
        deadLetteredAt: stoppedAt,
        lastErrorCode: "WHATSAPP_REPLY_RECEIVED",
        lastErrorMessage: "WhatsApp reply stopped pending calling/WhatsApp automation"
      }
    });
  }
}

export async function getMessagingHealth(input?: {
  env?: NodeJS.ProcessEnv;
  provider?: MessagingProvider;
}): Promise<MessagingHealthDto> {
  const config = getMessagingConfig(input?.env);
  const provider = input?.provider ?? createMessagingProvider(config);
  return provider.getHealth();
}

export function verifyMetaWebhookChallenge(input: {
  mode: string | undefined;
  token: string | undefined;
  challenge: string | undefined;
  env?: NodeJS.ProcessEnv;
}): string {
  const config = getMessagingConfig(input.env);
  if (
    input.mode === "subscribe" &&
    input.challenge &&
    input.token &&
    input.token === config.metaWhatsApp.webhookVerifyToken
  ) {
    return input.challenge;
  }

  throw new AppError(403, "AUTHORIZATION_ERROR", "Meta WhatsApp webhook verification failed");
}

async function processStatus(
  status: WebhookStatus,
  payload: Prisma.InputJsonObject
): Promise<void> {
  const providerEventId = `whatsapp-status:${status.id}:${status.status}:${status.timestamp ?? ""}`;
  const existingEvent = await prisma.whatsAppProviderEvent.findUnique({
    where: { provider_providerEventId: { provider: "META_WHATSAPP", providerEventId } }
  });
  if (existingEvent) return;

  const outbound = await prisma.outboundWhatsAppMessage.findUnique({
    where: { providerMessageId: status.id }
  });
  const mapped = statusToOutboundStatus(status.status);
  const failure =
    mapped.status === "FAILED" ? statusFailure(status) : { code: null, message: null };
  const happenedAt = whatsappTimestamp(status.timestamp);

  await prisma.$transaction(async (tx) => {
    await tx.whatsAppProviderEvent.create({
      data: {
        workspaceId: outbound?.workspaceId,
        provider: "META_WHATSAPP",
        providerEventId,
        providerMessageId: status.id,
        outboundMessageId: outbound?.id,
        type: "MESSAGE_STATUS",
        payload,
        failureCode: failure.code,
        failureMessage: failure.message,
        processedAt: new Date()
      }
    });
    if (!outbound) return;
    await tx.outboundWhatsAppMessage.update({
      where: { id: outbound.id },
      data: {
        status: mapped.status,
        [mapped.dateField]: happenedAt,
        failureCode: failure.code,
        failureMessage: failure.message
      }
    });
    await tx.activity.create({
      data: {
        workspaceId: outbound.workspaceId,
        leadId: outbound.leadId,
        type: mapped.status === "FAILED" ? "WHATSAPP_FAILED" : "WHATSAPP_STATUS_UPDATED",
        description:
          mapped.status === "FAILED"
            ? `WhatsApp delivery failed: ${failure.message ?? "provider reported failure"}`
            : `WhatsApp message status updated to ${mapped.status}`
      }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: outbound.workspaceId,
        actorType: "SYSTEM",
        entityType: "OutboundWhatsAppMessage",
        entityId: outbound.id,
        action: "WHATSAPP_STATUS_UPDATED",
        after: { providerMessageId: status.id, status: mapped.status, failure }
      }
    });
    await tx.domainEventOutbox.upsert({
      where: { idempotencyKey: `domain-event:whatsapp-status:${providerEventId}` },
      create: {
        workspaceId: outbound.workspaceId,
        eventType:
          mapped.status === "FAILED" ? "WHATSAPP_DELIVERY_FAILED" : "WHATSAPP_STATUS_UPDATED",
        aggregateType: "OutboundWhatsAppMessage",
        aggregateId: outbound.id,
        payload: {
          leadId: outbound.leadId,
          outboundWhatsAppMessageId: outbound.id,
          status: mapped.status
        },
        correlationId: outbound.id,
        idempotencyKey: `domain-event:whatsapp-status:${providerEventId}`
      },
      update: {}
    });
  });
  if (outbound) {
    await publishRealtimeEvent({
      entityType: "lead",
      action: mapped.status === "FAILED" ? "whatsapp-delivery-failed" : "whatsapp-status-updated",
      leadId: outbound.leadId,
      domainEventId: null,
      sourceEventType:
        mapped.status === "FAILED" ? "WHATSAPP_DELIVERY_FAILED" : "WHATSAPP_STATUS_UPDATED"
    }).catch(() => undefined);
  }
}

async function processInboundMessage(input: {
  provider: PersistedWhatsAppProvider;
  message: NormalizedInboundWhatsAppMessage;
  payload: Prisma.InputJsonObject;
  replyProcessingOptions?: ProcessReplyOptions;
}): Promise<void> {
  const { provider, message, payload } = input;
  const providerEventId = `whatsapp-inbound:${provider}:${message.id}`;
  const existingEvent = await prisma.whatsAppProviderEvent.findUnique({
    where: { provider_providerEventId: { provider, providerEventId } }
  });
  if (existingEvent) return;

  const match = await findLeadForInboundWhatsApp(message.from);
  const receivedAt = whatsappTimestamp(message.timestamp);
  const body = message.body;

  if (!match.ok) {
    await prisma.whatsAppProviderEvent.create({
      data: {
        provider,
        providerEventId,
        providerMessageId: message.id,
        type: "INBOUND_MESSAGE",
        payload,
        failureCode: match.code,
        failureMessage: match.message,
        processedAt: new Date()
      }
    });
    return;
  }

  const persisted = await prisma.$transaction(
    async (tx) => {
      const conversationId =
        match.conversationId ??
        (
          await tx.conversation.create({
            data: {
              workspaceId: match.workspaceId,
              leadId: match.leadId,
              channel: "WHATSAPP",
              mode: "AUTO",
              status: "OPEN"
            }
          })
        ).id;
      const persistedMessage = await tx.message.create({
        data: {
          workspaceId: match.workspaceId,
          conversationId,
          providerMessageId: message.id,
          direction: "INBOUND",
          senderType: "PROSPECT",
          body,
          deliveryStatus: "DELIVERED",
          deliveredAt: receivedAt,
          metadata: { provider: publicProvider(provider), type: message.type ?? "text" }
        }
      });
      await tx.whatsAppProviderEvent.create({
        data: {
          workspaceId: match.workspaceId,
          provider,
          providerEventId,
          providerMessageId: message.id,
          type: "INBOUND_MESSAGE",
          payload,
          processedAt: new Date()
        }
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: receivedAt }
      });
      await tx.lead.update({
        where: { id: match.leadId },
        data: { lastActivityAt: receivedAt }
      });
      await tx.activity.create({
        data: {
          workspaceId: match.workspaceId,
          leadId: match.leadId,
          type: "WHATSAPP_RECEIVED",
          description: "Inbound WhatsApp reply received"
        }
      });
      await tx.auditEvent.createMany({
        data: [
          {
            workspaceId: match.workspaceId,
            actorType: "SYSTEM",
            entityType: "Message",
            entityId: persistedMessage.id,
            action: "WHATSAPP_REPLY_RECEIVED",
            after: { provider: publicProvider(provider), conversationId }
          },
          {
            workspaceId: match.workspaceId,
            actorType: "SYSTEM",
            entityType: "Conversation",
            entityId: conversationId,
            action: "REPLY_PROCESSING_TRIGGERED",
            after: { messageId: persistedMessage.id, status: "PENDING" }
          }
        ]
      });
      await tx.domainEventOutbox.upsert({
        where: { idempotencyKey: `domain-event:whatsapp-reply:${persistedMessage.id}` },
        create: {
          workspaceId: match.workspaceId,
          eventType: "MESSAGE_RECEIVED",
          aggregateType: "Message",
          aggregateId: persistedMessage.id,
          payload: {
            leadId: match.leadId,
            conversationId,
            messageId: persistedMessage.id,
            channel: "WHATSAPP"
          },
          correlationId: conversationId,
          idempotencyKey: `domain-event:whatsapp-reply:${persistedMessage.id}`
        },
        update: {}
      });
      await stopIncompatibleAutomation(tx, match.leadId, match.workspaceId);
      return { conversationId, messageId: persistedMessage.id };
    },
    { maxWait: 10000, timeout: 30000 }
  );
  await publishRealtimeEvent({
    entityType: "lead",
    action: "whatsapp-reply-received",
    leadId: match.leadId,
    conversationId: persisted.conversationId,
    sourceEventType: "MESSAGE_RECEIVED"
  }).catch(() => undefined);
  await processInboundMessageReply(persisted.messageId, input.replyProcessingOptions);
}

export async function ingestMetaWhatsAppWebhook(input: {
  body: unknown;
  rawBody: string;
  signature: string | undefined;
  env?: NodeJS.ProcessEnv;
  provider?: MessagingProvider;
  replyProcessingOptions?: ProcessReplyOptions;
}): Promise<{ provider: "META_WHATSAPP"; processed: number }> {
  const config = getMessagingConfig(input.env);
  const provider = input.provider ?? createMessagingProvider(config);
  if (!provider.verifyWebhookSignature({ rawBody: input.rawBody, signature: input.signature })) {
    throw new AppError(
      403,
      "AUTHORIZATION_ERROR",
      "Meta WhatsApp webhook signature verification failed"
    );
  }

  const values = asWebhookValues(input.body);
  let processed = 0;
  for (const value of values) {
    const payload = value as unknown as Prisma.InputJsonObject;
    for (const status of value.statuses ?? []) {
      if (!status.id || !status.status) continue;
      await processStatus(status, payload);
      processed += 1;
    }
    for (const message of value.messages ?? []) {
      if (!message.id || !message.from) continue;
      await processInboundMessage({
        provider: "META_WHATSAPP",
        message: {
          id: message.id,
          from: message.from,
          timestamp: message.timestamp,
          type: message.type,
          body: inboundBody(message)
        },
        payload,
        replyProcessingOptions: input.replyProcessingOptions
      });
      processed += 1;
    }
  }

  return { provider: "META_WHATSAPP", processed };
}

function twilioParam(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeTwilioWhatsAppIdentity(value: string | undefined): string | undefined {
  return value?.replace(/^whatsapp:/iu, "").trim();
}

function twilioSignatureUrl(env: NodeJS.ProcessEnv | undefined, path: string): string {
  const config = getMessagingConfig(env);
  return `${config.webhookBaseUrl.replace(/\/$/u, "")}${path}`;
}

export async function ingestTwilioWhatsAppWebhook(input: {
  body: Record<string, unknown>;
  signature: string | undefined;
  url?: string;
  env?: NodeJS.ProcessEnv;
  provider?: TwilioWhatsAppProvider;
  replyProcessingOptions?: ProcessReplyOptions;
}): Promise<{ provider: "TWILIO_WHATSAPP"; processed: number }> {
  const config = getMessagingConfig(input.env);
  const provider = input.provider ?? new TwilioWhatsAppProvider(config);
  const params = Object.fromEntries(
    Object.entries(input.body).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : []
    )
  );
  const url = input.url ?? twilioSignatureUrl(input.env, "/api/messaging/twilio/webhook");
  if (!provider.verifyTwilioWebhookSignature({ url, params, signature: input.signature })) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Twilio WhatsApp webhook signature is invalid");
  }

  const messageSid =
    twilioParam(input.body, "MessageSid") ?? twilioParam(input.body, "SmsMessageSid");
  const from = normalizeTwilioWhatsAppIdentity(twilioParam(input.body, "From"));
  if (!messageSid || !from) {
    return { provider: "TWILIO_WHATSAPP", processed: 0 };
  }
  const body = twilioParam(input.body, "Body") ?? "";
  const timestamp = twilioParam(input.body, "Timestamp");
  await processInboundMessage({
    provider: "TWILIO",
    message: {
      id: messageSid,
      from,
      timestamp,
      type: "text",
      body: body.trim() || "[Unsupported WhatsApp message]"
    },
    payload: input.body as Prisma.InputJsonObject,
    replyProcessingOptions: input.replyProcessingOptions
  });
  return { provider: "TWILIO_WHATSAPP", processed: 1 };
}
