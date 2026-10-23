import { AgentType, type DomainEventOutbox, type Prisma } from "@prisma/client";
import { getMessagingConfig, type MessagingConfig } from "@shilabs/shared-config";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import { assertWorkspaceIntegrationEnabled } from "../integrations/integration-guard.js";
import {
  WorkerMetaWhatsAppProvider,
  WorkerTwilioWhatsAppProvider,
  type WorkerMessagingProvider
} from "../integrations/meta-whatsapp.provider.js";
import { ZohoTimelineSyncer, type TimelineSyncer } from "../followups/zoho-timeline.syncer.js";
import { normalizeAutomationPhone } from "../shared/automation-phone.js";
import { isAgentCapabilityActive } from "../shared/agent-control.js";
import { hasProspectInboundAfter } from "../shared/prospect-inbound.js";
import { deferChannelAttemptForPromise, recordPreferredFollowUpAccepted, resolvePreferredFollowUpChannel } from "../followups/preferred-followup.service.js";

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

function payloadBoolean(event: DomainEventOutbox, key: string): boolean {
  const payload = event.payload as Prisma.JsonObject;
  return payload[key] === true;
}

function safeMediaUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      return null;
    return url.toString();
  } catch {
    return null;
  }
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
  workspaceId: string;
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
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        contactId: input.contactId,
        callingAttemptId: input.callingAttemptId,
        provider: input.provider,
        toWhatsAppId: "not-configured",
        idempotencyKey: input.idempotencyKey,
        status: input.status,
        deliveryStatus: "FAILED",
        failureCode: input.code,
        failureMessage: input.message,
        failedAt: now
      },
      update: {
        status: input.status,
        deliveryStatus: "FAILED",
        failureCode: input.code,
        failureMessage: input.message,
        failedAt: now
      }
    });
    await tx.activity.create({
      data: {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        type: "WHATSAPP_FAILED",
        description: `WhatsApp automation blocked: ${input.message}`
      }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
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
  const eventWorkspaceId = input.event.workspaceId;
  if (!eventWorkspaceId) {
    throw new PermanentDomainEventError(
      "WORKSPACE_CONTEXT_MISSING",
      "WhatsApp event has no persisted workspace"
    );
  }
  const callingAttemptId = payloadString(input.event, "callingAttemptId");
  const leadId = payloadString(input.event, "leadId");
  const contactId = payloadString(input.event, "contactId");
  const textBody = payloadString(input.event, "textBody");
  const requestedMediaUrl = payloadString(input.event, "mediaUrl");
  const mediaUrl = safeMediaUrl(requestedMediaUrl);
  const mediaContentType = payloadString(input.event, "mediaContentType");
  const mediaFileName = payloadString(input.event, "mediaFileName");
  const voiceNote = payloadBoolean(input.event, "voiceNote");
  const replyToProviderMessageId = payloadString(input.event, "replyToProviderMessageId");
  if (!callingAttemptId || !leadId || !contactId) {
    throw new PermanentDomainEventError(
      "WHATSAPP_CONTEXT_MISSING",
      "WhatsApp send event context is incomplete"
    );
  }
  if (requestedMediaUrl && !mediaUrl) {
    throw new PermanentDomainEventError(
      "WHATSAPP_MEDIA_URL_INVALID",
      "WhatsApp media URL must be a public HTTPS URL without credentials or query secrets"
    );
  }
  const messageType = mediaUrl
    ? voiceNote || mediaContentType?.startsWith("audio/")
      ? "audio"
      : mediaContentType?.startsWith("image/")
        ? "image"
        : mediaContentType?.startsWith("video/")
          ? "video"
          : "document"
    : textBody
      ? "text"
      : "template";
  const mediaMetadata: Prisma.InputJsonArray = mediaUrl
    ? [
        {
          fileName: mediaFileName ?? `${messageType}-attachment`,
          contentType: mediaContentType ?? "application/octet-stream",
          sizeBytes: 0,
          contentId: null,
          disposition: "attachment",
          providerAttachmentId: null,
          mediaType: messageType,
          voiceNote
        }
      ]
    : [];

  const attempt = await workerPrisma.callingAttempt.findFirst({
    where: {
      id: callingAttemptId,
      leadId,
      contactId,
      sequence: { workspaceId: eventWorkspaceId }
    },
    include: {
      sequence: { include: { followUpSequence: true } },
      lead: {
        include: { contact: true, intelligence: true, conversations: true }
      }
    }
  });
  if (!attempt) {
    throw new PermanentDomainEventError("CALLING_ATTEMPT_NOT_FOUND", "Calling attempt not found");
  }

  const idempotencyKey = `whatsapp-send:${attempt.id}`;
  const existing = await workerPrisma.outboundWhatsAppMessage.findUnique({
    where: { idempotencyKey }
  });
  if (
    existing?.status === "SENT" ||
    existing?.status === "DELIVERED" ||
    existing?.status === "READ"
  ) {
    await recordPreferredFollowUpAccepted(input.event);
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
  const conversation = lead.conversations.find((item) => item.channel === "WHATSAPP");
  const activeTakeover = await workerPrisma.humanTakeover.findFirst({
    where: {
      status: "ACTIVE",
      OR: [{ leadId: lead.id }, ...(conversation ? [{ conversationId: conversation.id }] : [])]
    },
    select: { id: true }
  });
  const inboundAfterSequence = await hasProspectInboundAfter({
    leadId: lead.id,
    since: attempt.sequence.followUpSequence?.createdAt ?? attempt.sequence.createdAt
  });
  const to =
    lead.contact.whatsappId ??
    normalizeAutomationPhone(lead.contact.phone, config.e2eAllowedToNumbers);
  const agentActive = await isAgentCapabilityActive(eventWorkspaceId, AgentType.WHATSAPP);
  const preferredChannel = payloadString(input.event, "preferredChannel");
  const controlsBlocked =
    attempt.sequence.status === "STOPPED" ||
    (Boolean(preferredChannel) && attempt.sequence.status !== "ACTIVE") ||
    ["OFF", "PAUSED"].includes(lead.intelligence?.aiControlStatus ?? "") ||
    lead.intelligence?.humanInterventionRequired === true ||
    lead.conversations.some((item) => ["HUMAN", "PAUSED", "CLOSED"].includes(item.mode));
  const block: WhatsAppBlock | null = controlsBlocked
    ? ["AUTOMATION_PAUSED", "Lead or sequence controls block WhatsApp", "BLOCKED"]
    : preferredChannel &&
        (resolvePreferredFollowUpChannel(lead) !== preferredChannel ||
          attempt.sequence.followUpSequence?.status !== "ACTIVE")
      ? [
          "PREFERRED_CHANNEL_CHANGED",
          "Preferred channel or source follow-up sequence changed",
          "BLOCKED"
        ]
      : !agentActive
        ? ["AGENT_PAUSED", "WhatsApp agent is paused", "BLOCKED"]
        : !to
          ? ["WHATSAPP_ID_MISSING", "Contact WhatsApp identity is not usable", "FAILED"]
          : lead.contact.doNotContact
            ? ["CONTACT_DO_NOT_CONTACT", "Contact is marked do-not-contact", "BLOCKED"]
            : ["WON", "LOST", "DISQUALIFIED"].includes(lead.status)
              ? [
                  "TERMINAL_LEAD",
                  `Lead status ${lead.status} forbids WhatsApp automation`,
                  "BLOCKED"
                ]
              : lead.automationOwnershipState !== "AI_ACTIVE"
                ? [
                    "AI_OWNERSHIP_INACTIVE",
                    `Lead automation ownership is ${lead.automationOwnershipState}`,
                    "BLOCKED"
                  ]
                : conversation && ["HUMAN", "PAUSED", "CLOSED"].includes(conversation.mode)
                  ? [
                      "AUTOMATION_PAUSED",
                      `Conversation mode ${conversation.mode} blocks WhatsApp automation`,
                      "BLOCKED"
                    ]
                  : activeTakeover
                    ? [
                        "HUMAN_TAKEOVER_ACTIVE",
                        "Human takeover blocks WhatsApp automation",
                        "BLOCKED"
                      ]
                    : inboundAfterSequence
                      ? [
                          "INBOUND_REPLY_RECEIVED",
                          "Inbound reply stopped WhatsApp automation",
                          "BLOCKED"
                        ]
                      : config.nodeEnv !== "production" &&
                          config.e2eAllowedToNumbers.length > 0 &&
                          !config.e2eAllowedToNumbers.includes(to)
                        ? [
                            "E2E_NUMBER_NOT_ALLOWED",
                            "Destination number is not allowed for local E2E WhatsApp testing",
                            "FAILED"
                          ]
                        : missingMessagingConfig(config).length > 0
                          ? [
                              "WHATSAPP_NOT_CONFIGURED",
                              `Missing configuration: ${missingMessagingConfig(config).join(", ")}`,
                              "NOT_CONFIGURED"
                            ]
                          : null;

  if (block) {
    await markWhatsAppBlocked({
      workspaceId: eventWorkspaceId,
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
    throw new PermanentDomainEventError(
      "WHATSAPP_ID_MISSING",
      "Contact WhatsApp identity is not usable"
    );
  }

  if (await deferChannelAttemptForPromise(input.event, attempt.id)) return;
  const outbound = await workerPrisma.outboundWhatsAppMessage.upsert({
    where: { idempotencyKey },
    create: {
      workspaceId: attempt.sequence.workspaceId,
      leadId,
      contactId,
      callingAttemptId,
      conversationId: conversation?.id ?? null,
      toWhatsAppId,
      normalizedToPhone: normalizeAutomationPhone(lead.contact.phone, config.e2eAllowedToNumbers),
      provider: persistedProvider,
      fromPhoneNumberId:
        config.provider === "twilio_whatsapp"
          ? config.twilioWhatsApp.sandboxFrom
          : config.metaWhatsApp.phoneNumberId,
      templateName:
        config.provider === "twilio_whatsapp"
          ? config.twilioWhatsApp.contentSid || config.metaWhatsApp.defaultTemplateName
          : config.metaWhatsApp.defaultTemplateName,
      templateLanguage: config.metaWhatsApp.defaultTemplateLanguage,
      textBody,
      messageType,
      mediaMetadata,
      replyToProviderMessageId,
      senderType: "SYSTEM",
      deliveryStatus: "PENDING",
      idempotencyKey,
      status: "PROVIDER_PENDING"
    },
    update: {
      status: "PROVIDER_PENDING",
      deliveryStatus: "PENDING",
      providerStatus: "pending",
      failureCode: null,
      failureMessage: null
    }
  });

  const result = await (async () => {
    try {
      await assertWorkspaceIntegrationEnabled({
        workspaceId: eventWorkspaceId,
        provider: config.provider === "meta_whatsapp" ? "META_WHATSAPP" : "TWILIO",
        key: config.provider === "meta_whatsapp" ? "default" : "whatsapp"
      });
      if (await deferChannelAttemptForPromise(input.event, attempt.id)) return null;
      const provider = input.provider ?? createWorkerMessagingProvider(config);
      return await provider.sendTemplateMessage({
        to: toWhatsAppId,
        templateName: config.metaWhatsApp.defaultTemplateName,
        templateLanguage: config.metaWhatsApp.defaultTemplateLanguage,
        idempotencyKey,
        textBody,
        mediaUrl,
        mediaContentType,
        mediaFileName,
        voiceNote,
        replyToProviderMessageId
      });
    } catch (error) {
      await workerPrisma.outboundWhatsAppMessage.update({
        where: { id: outbound.id },
        data: {
          status: "FAILED",
          deliveryStatus: "FAILED",
          failureCode: "WHATSAPP_PROVIDER_ERROR",
          failureMessage:
            error instanceof Error ? error.message : "WhatsApp provider request failed",
          failedAt: new Date()
        }
      });
      throw error;
    }
  })();

  if (!result) return;

  if (result.status !== "ACCEPTED" || !result.providerMessageId) {
    await workerPrisma.outboundWhatsAppMessage.update({
      where: { id: outbound.id },
      data: {
        status: result.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED",
        deliveryStatus: "FAILED",
        providerStatus: result.providerStatus,
        failureCode:
          result.status === "NOT_CONFIGURED"
            ? "WHATSAPP_NOT_CONFIGURED"
            : "WHATSAPP_PROVIDER_ERROR",
        failureMessage: result.lastError ?? `${providerLabel} did not accept the message`,
        failedAt: new Date()
      }
    });
    await workerPrisma.activity.create({
      data: {
        workspaceId: attempt.sequence.workspaceId,
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
        deliveryStatus: "SENT",
        providerStatus: result.providerStatus,
        providerMessageId,
        sentAt: now,
        failureCode: null,
        failureMessage: null
      }
    });
    const messageConversation =
      conversation ??
      (await tx.conversation.create({
        data: {
          workspaceId: attempt.sequence.workspaceId,
          leadId,
          channel: "WHATSAPP",
          mode: "AUTO",
          status: "OPEN",
          lastMessageAt: now
        }
      }));
    await tx.message.upsert({
      where: { providerMessageId },
      create: {
        workspaceId: attempt.sequence.workspaceId,
        conversationId: messageConversation.id,
        providerMessageId,
        direction: "OUTBOUND",
        senderType: preferredChannel ? "AI" : "SYSTEM",
        body: textBody ?? `[WhatsApp ${messageType} sent]`,
        deliveryStatus: "SENT",
        sentAt: now,
        attachmentMetadata: mediaMetadata,
        providerReferences: replyToProviderMessageId ? [replyToProviderMessageId] : [],
        metadata: {
          outboundWhatsAppMessageId: updated.id,
          provider: persistedProvider,
          messageType
        }
      },
      update: {}
    });
    await tx.conversation.update({
      where: { id: messageConversation.id },
      data: { lastMessageAt: now }
    });
    const activity = await tx.activity.create({
      data: {
        workspaceId: attempt.sequence.workspaceId,
        leadId,
        type: "WHATSAPP_SENT",
        description: `WhatsApp message accepted by ${providerLabel}`
      }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: attempt.sequence.workspaceId,
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
        workspaceId_provider_entityType_localEntityId: {
          workspaceId: eventWorkspaceId,
          provider: persistedProvider,
          entityType: "WHATSAPP_MESSAGE",
          localEntityId: updated.id
        }
      },
      create: {
        workspaceId: eventWorkspaceId,
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
        workspaceId: attempt.sequence.workspaceId,
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

  await recordPreferredFollowUpAccepted(input.event);
  await syncWhatsAppToZoho({
    outboundMessageId: saved.outboundMessageId,
    activityId: saved.activityId,
    env: input.env ?? process.env,
    timelineSyncer: input.timelineSyncer
  });
}
