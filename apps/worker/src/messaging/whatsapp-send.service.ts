import type { DomainEventOutbox, Prisma } from "@prisma/client";
import { getMessagingConfig, type MessagingConfig } from "@shilabs/shared-config";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import {
  WorkerMetaWhatsAppProvider,
  WorkerTwilioWhatsAppProvider,
  type WorkerMessagingProvider
} from "../integrations/meta-whatsapp.provider.js";
import { ZohoTimelineSyncer, type TimelineSyncer } from "../followups/zoho-timeline.syncer.js";

type WhatsAppBlock = readonly [
  code: string,
  message: string,
  status: "BLOCKED" | "FAILED" | "NOT_CONFIGURED"
];

function payloadString(event: DomainEventOutbox, key: string): string | null {
  const payload = event.payload as Prisma.JsonObject;
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const normalized = phone.trim().replace(/[()\s.-]/g, "");
  return /^\+?[1-9]\d{7,14}$/u.test(normalized)
    ? (normalized.startsWith("+") ? normalized : `+${normalized}`)
    : null;
}

function missingMessagingConfig(config: MessagingConfig): string[] {
  const missing: string[] = [];
  if (config.provider === "meta_whatsapp") {
    if (!config.metaWhatsApp.accessToken) missing.push("WHATSAPP_ACCESS_TOKEN");
    if (!config.metaWhatsApp.phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
    if (!config.metaWhatsApp.defaultTemplateName) missing.push("WHATSAPP_DEFAULT_TEMPLATE_NAME");
    return missing;
  }
  if (config.provider === "twilio_whatsapp") {
    if (!config.twilioWhatsApp.accountSid) missing.push("TWILIO_WHATSAPP_ACCOUNT_SID");
    if (!config.twilioWhatsApp.authToken) missing.push("TWILIO_WHATSAPP_AUTH_TOKEN");
    if (!config.twilioWhatsApp.sandboxFrom) missing.push("TWILIO_WHATSAPP_SANDBOX_FROM");
    return missing;
  }
  missing.push("MESSAGING_PROVIDER");
  return missing;
}

function persistedMessagingProvider(config: MessagingConfig): "META_WHATSAPP" | "TWILIO" {
  return config.provider === "twilio_whatsapp" ? "TWILIO" : "META_WHATSAPP";
}

function messagingProviderLabel(config: MessagingConfig): "Meta WhatsApp" | "Twilio WhatsApp" {
  return config.provider === "twilio_whatsapp" ? "Twilio WhatsApp" : "Meta WhatsApp";
}

function createWorkerMessagingProvider(config: MessagingConfig): WorkerMessagingProvider {
  return config.provider === "twilio_whatsapp"
    ? new WorkerTwilioWhatsAppProvider(config)
    : new WorkerMetaWhatsAppProvider(config);
}

async function markWhatsAppBlocked(input: {
  leadId: string;
  contactId: string;
  callingAttemptId: string | null;
  provider: "META_WHATSAPP" | "TWILIO";
  idempotencyKey: string;
  code: string;
  message: string;
  status: "BLOCKED" | "FAILED" | "NOT_CONFIGURED";
}): Promise<void> {
  const now = new Date();
  await workerPrisma.$transaction(async (tx) => {
    const outbound = await tx.outboundWhatsAppMessage.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: {
        leadId: input.leadId,
        contactId: input.contactId,
        callingAttemptId: input.callingAttemptId,
        provider: input.provider,
        toWhatsAppId: "not-configured",
        idempotencyKey: input.idempotencyKey,
        status: input.status,
        failureCode: input.code,
        failureMessage: input.message,
        failedAt: now
      },
      update: {
        status: input.status,
        failureCode: input.code,
        failureMessage: input.message,
        failedAt: now
      }
    });
    await tx.activity.create({
      data: {
        leadId: input.leadId,
        type: "WHATSAPP_FAILED",
        description: `WhatsApp automation blocked: ${input.message}`
      }
    });
    await tx.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "OutboundWhatsAppMessage",
        entityId: outbound.id,
        action: "WHATSAPP_SEND_BLOCKED",
        after: { code: input.code, message: input.message }
      }
    });
  });
}

async function syncWhatsAppToZoho(input: {
  outboundMessageId: string;
  activityId: string;
  env: NodeJS.ProcessEnv;
  timelineSyncer?: TimelineSyncer;
}): Promise<void> {
  const syncer = input.timelineSyncer ?? new ZohoTimelineSyncer(workerPrisma);
  const result = await syncer.syncActivity({ activityId: input.activityId, env: input.env });
  if (result.status === "SYNCED" || result.status === "SKIPPED") {
    await workerPrisma.outboundWhatsAppMessage.update({
      where: { id: input.outboundMessageId },
      data: { zohoSyncStatus: "SYNCED", zohoLastError: null }
    });
    return;
  }

  await workerPrisma.outboundWhatsAppMessage.update({
    where: { id: input.outboundMessageId },
    data: { zohoSyncStatus: "FAILED", zohoLastError: result.lastError }
  });
  throw new Error(result.lastError ?? "Zoho timeline sync failed");
}

export async function executeWhatsAppSend(input: {
  event: DomainEventOutbox;
  env?: NodeJS.ProcessEnv;
  provider?: WorkerMessagingProvider;
  timelineSyncer?: TimelineSyncer;
}): Promise<void> {
  const callingAttemptId = payloadString(input.event, "callingAttemptId");
  const leadId = payloadString(input.event, "leadId");
  const contactId = payloadString(input.event, "contactId");
  if (!callingAttemptId || !leadId || !contactId) {
    throw new PermanentDomainEventError("WHATSAPP_CONTEXT_MISSING", "WhatsApp send event context is incomplete");
  }

  const attempt = await workerPrisma.callingAttempt.findUnique({
    where: { id: callingAttemptId },
    include: {
      sequence: true,
      lead: { include: { contact: true, conversations: { where: { channel: "WHATSAPP" }, take: 1 } } }
    }
  });
  if (!attempt) {
    throw new PermanentDomainEventError("CALLING_ATTEMPT_NOT_FOUND", "Calling attempt not found");
  }

  const idempotencyKey = `whatsapp-send:${attempt.id}`;
  const existing = await workerPrisma.outboundWhatsAppMessage.findUnique({ where: { idempotencyKey } });
  if (existing?.status === "SENT" || existing?.status === "DELIVERED" || existing?.status === "READ") {
    const activity = await workerPrisma.activity.findFirst({
      where: { leadId: existing.leadId, type: "WHATSAPP_SENT" },
      orderBy: { createdAt: "desc" }
    });
    if (existing.zohoSyncStatus !== "SYNCED" && activity) {
      await syncWhatsAppToZoho({
        outboundMessageId: existing.id,
        activityId: activity.id,
        env: input.env ?? process.env,
        timelineSyncer: input.timelineSyncer
      });
    }
    return;
  }

  const config = getMessagingConfig(input.env);
  const persistedProvider = persistedMessagingProvider(config);
  const providerLabel = messagingProviderLabel(config);
  const lead = attempt.lead;
  const conversation = lead.conversations[0];
  const activeTakeover = await workerPrisma.humanTakeover.findFirst({
    where: {
      status: "ACTIVE",
      OR: [{ leadId: lead.id }, ...(conversation ? [{ conversationId: conversation.id }] : [])]
    },
    select: { id: true }
  });
  const inboundAfterSequence = await workerPrisma.message.count({
    where: {
      conversation: { leadId: lead.id },
      direction: "INBOUND",
      createdAt: { gte: attempt.sequence.createdAt }
    }
  });
  const to = lead.contact.whatsappId ?? normalizePhone(lead.contact.phone);
  const block: WhatsAppBlock | null =
    attempt.sequence.status !== "ACTIVE"
      ? ["CALLING_SEQUENCE_NOT_ACTIVE", `Calling sequence status is ${attempt.sequence.status}`, "BLOCKED"]
      : !to
        ? ["WHATSAPP_ID_MISSING", "Contact WhatsApp identity is not usable", "FAILED"]
        : lead.contact.doNotContact
          ? ["CONTACT_DO_NOT_CONTACT", "Contact is marked do-not-contact", "BLOCKED"]
          : ["WON", "LOST", "DISQUALIFIED"].includes(lead.status)
            ? ["TERMINAL_LEAD", `Lead status ${lead.status} forbids WhatsApp automation`, "BLOCKED"]
            : conversation && ["HUMAN", "PAUSED", "CLOSED"].includes(conversation.mode)
              ? ["AUTOMATION_PAUSED", `Conversation mode ${conversation.mode} blocks WhatsApp automation`, "BLOCKED"]
              : activeTakeover
                ? ["HUMAN_TAKEOVER_ACTIVE", "Human takeover blocks WhatsApp automation", "BLOCKED"]
                : inboundAfterSequence > 0
                  ? ["INBOUND_REPLY_RECEIVED", "Inbound reply stopped WhatsApp automation", "BLOCKED"]
                  : config.nodeEnv !== "production" &&
                      config.e2eAllowedToNumbers.length > 0 &&
                      !config.e2eAllowedToNumbers.includes(to)
                    ? ["E2E_NUMBER_NOT_ALLOWED", "Destination number is not allowed for local E2E WhatsApp testing", "FAILED"]
                    : missingMessagingConfig(config).length > 0
                      ? [
                          "WHATSAPP_NOT_CONFIGURED",
                          `Missing configuration: ${missingMessagingConfig(config).join(", ")}`,
                          "NOT_CONFIGURED"
                        ]
                      : null;

  if (block) {
    await markWhatsAppBlocked({
      leadId,
      contactId,
      callingAttemptId,
      provider: persistedProvider,
      idempotencyKey,
      code: block[0],
      message: block[1],
      status: block[2]
    });
    throw new PermanentDomainEventError(block[0], block[1]);
  }

  const toWhatsAppId = to;
  if (!toWhatsAppId) {
    throw new PermanentDomainEventError("WHATSAPP_ID_MISSING", "Contact WhatsApp identity is not usable");
  }

  const outbound = await workerPrisma.outboundWhatsAppMessage.upsert({
    where: { idempotencyKey },
    create: {
      leadId,
      contactId,
      callingAttemptId,
      conversationId: conversation?.id ?? null,
      toWhatsAppId,
      normalizedToPhone: normalizePhone(lead.contact.phone),
      provider: persistedProvider,
      fromPhoneNumberId:
        config.provider === "twilio_whatsapp"
          ? config.twilioWhatsApp.sandboxFrom
          : config.metaWhatsApp.phoneNumberId,
      templateName: config.metaWhatsApp.defaultTemplateName,
      templateLanguage: config.metaWhatsApp.defaultTemplateLanguage,
      idempotencyKey,
      status: "PROVIDER_PENDING"
    },
    update: { status: "PROVIDER_PENDING", failureCode: null, failureMessage: null }
  });

  const provider = input.provider ?? createWorkerMessagingProvider(config);
  const result = await provider.sendTemplateMessage({
    to: toWhatsAppId,
    templateName: config.metaWhatsApp.defaultTemplateName,
    templateLanguage: config.metaWhatsApp.defaultTemplateLanguage,
    idempotencyKey
  });

  if (result.status !== "ACCEPTED" || !result.providerMessageId) {
    await workerPrisma.outboundWhatsAppMessage.update({
      where: { id: outbound.id },
      data: {
        status: result.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED",
        failureCode: result.status === "NOT_CONFIGURED" ? "WHATSAPP_NOT_CONFIGURED" : "WHATSAPP_PROVIDER_ERROR",
        failureMessage: result.lastError ?? `${providerLabel} did not accept the message`,
        failedAt: new Date()
      }
    });
    await workerPrisma.activity.create({
      data: {
        leadId,
        type: "WHATSAPP_FAILED",
        description: result.lastError ?? `${providerLabel} did not accept the message`
      }
    });
    throw new PermanentDomainEventError(
      result.status === "NOT_CONFIGURED" ? "WHATSAPP_NOT_CONFIGURED" : "WHATSAPP_PROVIDER_ERROR",
      result.lastError ?? `${providerLabel} did not accept the message`
    );
  }

  const providerMessageId = result.providerMessageId;
  const now = new Date();
  const saved = await workerPrisma.$transaction(async (tx) => {
    const updated = await tx.outboundWhatsAppMessage.update({
      where: { id: outbound.id },
      data: {
        status: "SENT",
        providerMessageId,
        sentAt: now,
        failureCode: null,
        failureMessage: null
      }
    });
    const activity = await tx.activity.create({
      data: {
        leadId,
        type: "WHATSAPP_SENT",
        description: `WhatsApp message accepted by ${providerLabel}`
      }
    });
    await tx.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "OutboundWhatsAppMessage",
        entityId: updated.id,
        action: "WHATSAPP_MESSAGE_SENT",
        after: {
          provider: persistedProvider,
          providerMessageId,
          templateName: config.metaWhatsApp.defaultTemplateName,
          templatePolicy: "UNRESOLVED_OC_08"
        }
      }
    });
    await tx.externalRecordMapping.upsert({
      where: {
        provider_entityType_localEntityId: {
          provider: persistedProvider,
          entityType: "WHATSAPP_MESSAGE",
          localEntityId: updated.id
        }
      },
      create: {
        provider: persistedProvider,
        entityType: "WHATSAPP_MESSAGE",
        localEntityId: updated.id,
        externalRecordId: providerMessageId,
        syncDirection: "OUTBOUND",
        syncStatus: "SYNCED",
        lastSyncedAt: now,
        idempotencyKey: `${config.provider}:message:${updated.id}`
      },
      update: {
        externalRecordId: providerMessageId,
        syncStatus: "SYNCED",
        lastSyncedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null
      }
    });
    await tx.domainEventOutbox.upsert({
      where: { idempotencyKey: `domain-event:whatsapp-sent:${updated.id}` },
      create: {
        eventType: "WHATSAPP_SENT",
        aggregateType: "OutboundWhatsAppMessage",
        aggregateId: updated.id,
        payload: { leadId, outboundWhatsAppMessageId: updated.id, providerMessageId },
        correlationId: updated.id,
        idempotencyKey: `domain-event:whatsapp-sent:${updated.id}`
      },
      update: {}
    });
    return { outboundMessageId: updated.id, activityId: activity.id };
  });

  await syncWhatsAppToZoho({
    outboundMessageId: saved.outboundMessageId,
    activityId: saved.activityId,
    env: input.env ?? process.env,
    timelineSyncer: input.timelineSyncer
  });
}
