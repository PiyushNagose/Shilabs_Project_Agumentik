import { Prisma } from "@prisma/client";
import { getMessagingConfig } from "@shilabs/shared-config";
import type {
  ActivityDto,
  ConversationDto,
  HumanTakeoverBriefingDto,
  HumanTakeoverDto,
  HumanConversationReplyDto,
  HumanWhatsAppReplyDto,
  MessageDto
} from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { isWorkspaceManager } from "../authorization/workspace-permissions.js";
import { toDealDto } from "../deals/deal.service.js";
import { sendOutboundEmail } from "../email/email.service.js";
import type { EmailProvider } from "../email/email.provider.js";
import type { AIProvider } from "../ai/ai.provider.js";
import { appendActivityToZohoTimeline } from "../integrations/zoho-bigin/zoho-bigin-timeline.service.js";
import { findDealByLeadId } from "../deals/deal.repository.js";
import { findLeadById } from "../leads/lead.repository.js";
import {
  assertCanAccessLead,
  assertCanMutateLead,
  leadVisibilityWhere
} from "../leads/lead.permissions.js";
import { toLeadDto } from "../leads/lead.service.js";
import {
  activateHuman,
  completeHumanAction,
  completeHumanActionInTransaction,
  requireHumanAction,
  stopAi
} from "../leads/lead-automation-ownership.service.js";
import { autoStartLeadAiAutomation } from "../followups/lead-ai-automation.service.js";
import { listProposals } from "../proposals/proposal.service.js";
import { getQualification } from "../qualification/qualification.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import { completeTask } from "../tasks/task.service.js";
import { sendWhatsAppText, type MessagingTransport } from "../messaging/messaging.provider.js";
import { conversationEvents, messageEvents } from "./conversation.events.js";
import type {
  CreateConversationInput,
  CreateMessageInput,
  ListConversationsQuery,
  SendHumanReplyInput,
  StartHumanTakeoverInput,
  UpdateConversationModeInput
} from "./conversation.schemas.js";
import {
  appendMessageWithConversationUpdate,
  createConversationRecord,
  findConversationById,
  listConversationRecords,
  listMessages as listMessageRecords,
  updateConversationModeWithAudit,
  type ConversationRecord,
  type MessageRecord
} from "./conversation.repository.js";
import type { CommunicationAttachmentDto } from "@shilabs/shared-types";

function messageAttachments(value: Prisma.JsonValue | null): CommunicationAttachmentDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.fileName !== "string" ||
      typeof record.contentType !== "string" ||
      typeof record.sizeBytes !== "number"
    )
      return [];
    const mediaType = String(record.mediaType);
    return [
      {
        fileName: record.fileName,
        contentType: record.contentType,
        sizeBytes: record.sizeBytes,
        contentId: typeof record.contentId === "string" ? record.contentId : null,
        disposition:
          record.disposition === "inline" ? ("inline" as const) : ("attachment" as const),
        providerAttachmentId:
          typeof record.providerAttachmentId === "string" ? record.providerAttachmentId : null,
        mediaType: ["document", "image", "audio", "video", "sticker", "file"].includes(mediaType)
          ? (mediaType as CommunicationAttachmentDto["mediaType"])
          : "file",
        voiceNote: record.voiceNote === true
      }
    ];
  });
}

export function toConversationDto(conversation: ConversationRecord): ConversationDto {
  return {
    id: conversation.id,
    leadId: conversation.leadId,
    channel: conversation.channel,
    mode: conversation.mode,
    status: conversation.status,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    lead: toLeadDto(conversation.lead)
  };
}

export function toMessageDto(message: MessageRecord): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    providerMessageId: message.providerMessageId,
    direction: message.direction,
    senderType: message.senderType,
    senderUserId: message.senderUserId,
    body: message.body,
    deliveryStatus: message.deliveryStatus,
    sentAt: message.sentAt?.toISOString() ?? null,
    deliveredAt: message.deliveredAt?.toISOString() ?? null,
    readAt: message.readAt?.toISOString() ?? null,
    failedAt: message.failedAt?.toISOString() ?? null,
    metadata: message.metadata,
    attachments: messageAttachments(message.attachmentMetadata),
    providerThreadId: message.providerThreadId,
    providerReferences: message.providerReferences,
    createdAt: message.createdAt.toISOString(),
    senderUser: message.senderUser ? toPublicUser(message.senderUser) : null
  };
}

async function publishConversationUpdate(
  leadId: string,
  conversationId: string,
  action: string
): Promise<void> {
  await publishRealtimeEvent({
    entityType: "conversation",
    action,
    leadId,
    conversationId
  });
}

type HumanTakeoverRecord = Prisma.HumanTakeoverGetPayload<{ include: { takenOverBy: true } }>;

export function toHumanTakeoverDto(takeover: HumanTakeoverRecord): HumanTakeoverDto {
  return {
    id: takeover.id,
    leadId: takeover.leadId,
    conversationId: takeover.conversationId,
    takenOverByUserId: takeover.takenOverByUserId,
    status: takeover.status,
    reason: takeover.reason,
    createdAt: takeover.createdAt.toISOString(),
    updatedAt: takeover.updatedAt.toISOString(),
    takenOverBy: toPublicUser(takeover.takenOverBy)
  };
}

function toActivityDto(
  activity: Prisma.ActivityGetPayload<{ include: { actorUser: true } }>
): ActivityDto {
  return {
    id: activity.id,
    leadId: activity.leadId,
    entityType: activity.entityType,
    entityId: activity.entityId ?? activity.leadId,
    actorType: activity.actorType,
    actorUserId: activity.actorUserId,
    actorAgentId: activity.actorAgentId,
    sourceType: activity.sourceType,
    sourceId: activity.sourceId,
    type: activity.type,
    title: activity.title ?? activity.type.replaceAll("_", " ").toLowerCase(),
    summary: activity.description,
    description: activity.description,
    metadata: activity.metadata,
    occurredAt: activity.occurredAt.toISOString(),
    correlationId: activity.correlationId,
    visibility: activity.visibility,
    createdAt: activity.createdAt.toISOString(),
    actorUser: activity.actorUser ? toPublicUser(activity.actorUser) : null
  };
}

function requireConversation(conversation: ConversationRecord | null): ConversationRecord {
  if (!conversation) {
    throw new AppError(404, "NOT_FOUND", "Conversation not found");
  }

  return conversation;
}

function getModeSnapshot(conversation: ConversationRecord): Prisma.InputJsonObject {
  return {
    id: conversation.id,
    mode: conversation.mode,
    status: conversation.status
  };
}

function parseOptionalDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value ? new Date(value) : null;
}

function defaultHumanReplySubject(conversation: ConversationRecord): string {
  return `Re: ${conversation.lead.company.name}`;
}

function assertHumanReplyActor(actor: AuthenticatedUser, conversation: ConversationRecord): void {
  if (isWorkspaceManager(actor)) return;
  if (conversation.lead.ownerId === actor.id) return;
  throw new AppError(
    403,
    "AUTHORIZATION_ERROR",
    "Only the assigned owner can send this human reply"
  );
}

interface SendHumanReplyOptions {
  env?: NodeJS.ProcessEnv;
  emailProvider?: EmailProvider;
  aiProvider?: AIProvider;
  zohoTransport?: typeof fetch;
}

export async function createConversation(
  actor: AuthenticatedUser,
  input: CreateConversationInput
): Promise<ConversationDto> {
  const lead = await findLeadById(input.leadId);
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }
  assertCanMutateLead(actor, lead);

  const conversation = await createConversationRecord({
    workspaceId: lead.workspaceId,
    lead: { connect: { id: lead.id } },
    channel: input.channel,
    mode: input.mode
  });

  await publishConversationUpdate(lead.id, conversation.id, "conversation-created");
  return toConversationDto(conversation);
}

export async function listConversations(
  actor: AuthenticatedUser,
  query: ListConversationsQuery
): Promise<ConversationDto[]> {
  return (
    await listConversationRecords({
      leadId: query.leadId,
      channel: query.channel,
      mode: query.mode,
      status: query.status,
      lead: leadVisibilityWhere(actor)
    })
  ).map(toConversationDto);
}

export async function getConversation(
  actor: AuthenticatedUser,
  conversationId: string
): Promise<ConversationDto> {
  const conversation = requireConversation(await findConversationById(conversationId));
  assertCanAccessLead(actor, conversation.lead);
  return toConversationDto(conversation);
}

export async function listMessages(
  actor: AuthenticatedUser,
  conversationId: string
): Promise<MessageDto[]> {
  const conversation = requireConversation(await findConversationById(conversationId));
  assertCanAccessLead(actor, conversation.lead);
  return (await listMessageRecords(conversationId)).map(toMessageDto);
}

export async function appendMessage(
  actor: AuthenticatedUser,
  conversationId: string,
  input: CreateMessageInput
): Promise<MessageDto> {
  const conversation = requireConversation(await findConversationById(conversationId));
  assertCanMutateLead(actor, conversation.lead);
  if (conversation.status === "CLOSED") {
    throw new AppError(409, "CONFLICT", "Cannot append messages to a closed conversation");
  }

  const senderUserId =
    input.senderType === "USER" ? (input.senderUserId ?? actor.id) : (input.senderUserId ?? null);
  const sentAt = parseOptionalDate(input.sentAt);
  const deliveredAt = parseOptionalDate(input.deliveredAt);
  const readAt = parseOptionalDate(input.readAt);
  const failedAt = parseOptionalDate(input.failedAt);
  const lastMessageAt = sentAt ?? new Date();
  const activityActorUserId = input.senderType === "USER" ? senderUserId : null;

  const message = await appendMessageWithConversationUpdate({
    conversationId: conversation.id,
    leadId: conversation.leadId,
    lastMessageAt,
    activity: {
      type: input.direction === "INBOUND" ? messageEvents.received : messageEvents.sent,
      description:
        input.direction === "INBOUND"
          ? "Inbound prospect message recorded"
          : "Outbound conversation message recorded",
      actorUserId: activityActorUserId
    },
    message: {
      workspaceId: conversation.lead.workspaceId,
      conversation: { connect: { id: conversation.id } },
      providerMessageId: input.providerMessageId ?? null,
      direction: input.direction,
      senderType: input.senderType,
      senderUser: senderUserId ? { connect: { id: senderUserId } } : undefined,
      body: input.body,
      deliveryStatus: input.deliveryStatus ?? "PENDING",
      sentAt,
      deliveredAt,
      readAt,
      failedAt,
      metadata:
        input.metadata === undefined || input.metadata === null
          ? undefined
          : (input.metadata as Prisma.InputJsonObject)
    }
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "CONFLICT", "Provider message already exists");
    }

    throw error;
  });

  await publishConversationUpdate(conversation.leadId, conversation.id, "message-appended");
  return toMessageDto(message);
}

export async function sendHumanReply(
  actor: AuthenticatedUser,
  conversationId: string,
  input: SendHumanReplyInput,
  options?: SendHumanReplyOptions
): Promise<HumanConversationReplyDto> {
  const conversation = requireConversation(await findConversationById(conversationId));
  if (conversation.status === "CLOSED") {
    throw new AppError(409, "CONFLICT", "Cannot reply on a closed conversation");
  }
  if (conversation.channel !== "EMAIL") {
    throw new AppError(409, "CONFLICT", "Human replies can only be sent on email conversations");
  }
  assertCanMutateLead(actor, conversation.lead);
  assertHumanReplyActor(actor, conversation);

  const subject = input.subject ?? defaultHumanReplySubject(conversation);
  const idempotencyKey = `human-reply:${conversation.id}:${input.idempotencyKey}`;
  const existingOutboundEmail = await prisma.outboundEmail.findUnique({
    where: { idempotencyKey },
    select: { id: true }
  });
  if (conversation.mode !== "HUMAN" && !existingOutboundEmail) {
    throw new AppError(409, "CONFLICT", "Human replies require conversation mode HUMAN");
  }
  const pendingHumanEmailTask =
    conversation.mode === "HUMAN" &&
    ["HUMAN_ACTIVE", "HUMAN_REQUIRED"].includes(conversation.lead.automationOwnershipState)
      ? ((
          await prisma.task.findMany({
            where: {
              leadId: conversation.leadId,
              isNextAction: true,
              status: { in: ["OPEN", "IN_PROGRESS"] }
            },
            orderBy: { updatedAt: "desc" }
          })
        ).find((task) => /email|message|outreach/iu.test(task.title)) ?? null)
      : null;
  const outboundEmail = await sendOutboundEmail(
    actor,
    {
      leadId: conversation.leadId,
      subject,
      textBody: input.body,
      idempotencyKey
    },
    { env: options?.env, provider: options?.emailProvider }
  );

  if (outboundEmail.status !== "SENT") {
    return { outboundEmail, message: null, zohoTimeline: null };
  }

  let message = await prisma.message.findUnique({
    where: { providerMessageId: outboundEmail.providerMessageId ?? "" },
    include: { senderUser: true }
  });
  if (!message) {
    message = await prisma.message.create({
      data: {
        workspaceId: conversation.lead.workspaceId,
        conversationId: conversation.id,
        providerMessageId: outboundEmail.providerMessageId,
        direction: "OUTBOUND",
        senderType: "USER",
        senderUserId: actor.id,
        body: input.body,
        deliveryStatus: "SENT",
        sentAt: outboundEmail.sentAt ? new Date(outboundEmail.sentAt) : new Date(),
        metadata: {
          outboundEmailId: outboundEmail.id,
          source: "HUMAN_REPLY",
          idempotencyKey
        }
      },
      include: { senderUser: true }
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: message.sentAt ?? message.createdAt }
    });
    await prisma.auditEvent.create({
      data: {
        actorType: "USER",
        actorId: actor.id,
        entityType: "Message",
        entityId: message.id,
        action: "HUMAN_REPLY_SENT",
        after: {
          conversationId: conversation.id,
          leadId: conversation.leadId,
          outboundEmailId: outboundEmail.id,
          providerMessageId: outboundEmail.providerMessageId
        }
      }
    });
  }

  let zohoTimeline: HumanConversationReplyDto["zohoTimeline"] = null;
  const sentActivity = await prisma.activity.findFirst({
    where: {
      leadId: conversation.leadId,
      type: "MESSAGE_SENT",
      description: { contains: outboundEmail.id }
    },
    orderBy: { createdAt: "desc" }
  });
  const activity =
    sentActivity ??
    (await prisma.activity.findFirst({
      where: {
        leadId: conversation.leadId,
        type: "MESSAGE_SENT",
        description: { contains: subject }
      },
      orderBy: { createdAt: "desc" }
    }));
  if (activity) {
    try {
      zohoTimeline = await appendActivityToZohoTimeline({
        activityId: activity.id,
        env: options?.env,
        transport: options?.zohoTransport
      });
    } catch (error) {
      zohoTimeline = {
        provider: "ZOHO_BIGIN",
        status: "FAILED",
        activityId: activity.id,
        mappingId: null,
        externalRecordId: null,
        lastError: error instanceof Error ? error.message : "Zoho timeline sync failed"
      };
      await prisma.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          entityType: "OutboundEmail",
          entityId: outboundEmail.id,
          action: "HUMAN_REPLY_ZOHO_TIMELINE_SYNC_FAILED",
          after: { activityId: activity.id, lastError: zohoTimeline.lastError }
        }
      });
    }
  }

  if (pendingHumanEmailTask) {
    await completeTask(actor, pendingHumanEmailTask.id);
  }

  await prisma.followUpSequence.updateMany({
    where: {
      workspaceId: conversation.lead.workspaceId,
      leadId: conversation.leadId,
      status: "ATTENTION_REQUIRED",
      createdAt: { lte: new Date(outboundEmail.sentAt ?? message.createdAt) },
      OR: [
        { lastErrorCode: "AI_FOLLOW_UP_REQUIRES_REVIEW" },
        { lastErrorMessage: "A salesperson must review this follow-up." }
      ]
    },
    data: { status: "STOPPED", stopReason: "HUMAN_REVIEW_COMPLETED", stoppedAt: new Date() }
  });

  const ownership = await completeHumanAction({
    leadId: conversation.leadId,
    reason: "HUMAN_REPLY_SENT",
    actorType: "USER",
    actorId: actor.id,
    sourceType: "CONVERSATION",
    sourceId: conversation.id,
    correlationId: outboundEmail.id
  });
  if (ownership.activated) {
    await autoStartLeadAiAutomation(actor, conversation.leadId, {
      env: options?.env,
      provider: options?.aiProvider,
      cycleKey: `human-reply:${outboundEmail.id}`
    });
  }

  await publishConversationUpdate(conversation.leadId, conversation.id, "human-reply-sent");
  return { outboundEmail, message: toMessageDto(message), zohoTimeline };
}

export async function sendHumanWhatsAppReply(
  actor: AuthenticatedUser,
  conversationId: string,
  input: SendHumanReplyInput,
  options?: { env?: NodeJS.ProcessEnv; transport?: MessagingTransport; aiProvider?: AIProvider }
): Promise<HumanWhatsAppReplyDto> {
  const conversation = requireConversation(await findConversationById(conversationId));
  assertCanMutateLead(actor, conversation.lead);
  assertHumanReplyActor(actor, conversation);
  if (conversation.channel !== "WHATSAPP" || conversation.status !== "OPEN") {
    throw new AppError(409, "CONFLICT", "Select an open WhatsApp conversation");
  }
  const idempotencyKey = `human-whatsapp:${conversationId}:${input.idempotencyKey}`;
  let outbound = await prisma.outboundWhatsAppMessage.findUnique({ where: { idempotencyKey } });
  if (outbound && (outbound.textBody !== input.body || outbound.workspaceId !== conversation.lead.workspaceId)) {
    throw new AppError(409, "CONFLICT", "This reply request was already used for another message");
  }
  if (conversation.mode !== "HUMAN" && !outbound) {
    throw new AppError(409, "CONFLICT", "Take over the WhatsApp conversation before replying");
  }
  if (!outbound && (conversation.lead.contact.doNotContact || ["WON", "LOST", "DISQUALIFIED"].includes(conversation.lead.status))) {
    throw new AppError(409, "CONFLICT", "This contact cannot receive a WhatsApp reply");
  }
  const latestInbound = outbound ? null : await prisma.message.findFirst({
    where: { conversationId, direction: "INBOUND", senderType: "PROSPECT" },
    orderBy: { createdAt: "desc" }
  });
  if (!outbound && (!latestInbound || Date.now() - latestInbound.createdAt.getTime() >= 24 * 60 * 60 * 1000)) {
    throw new AppError(409, "CONFLICT", "The WhatsApp reply window has closed. Use an approved template to contact this customer.");
  }
  const to = conversation.lead.contact.whatsappId ?? conversation.lead.contact.normalizedPhone;
  if (!to || !/^\+?[1-9]\d{7,14}$/u.test(to)) {
    throw new AppError(409, "CONFLICT", "Add a valid WhatsApp number to this contact first");
  }
  const workspaceId = conversation.lead.workspaceId;
  if (!workspaceId) throw new AppError(409, "CONFLICT", "Lead workspace is missing");
  const config = getMessagingConfig(options?.env);
  const provider = config.provider === "twilio_whatsapp" ? "TWILIO" : "META_WHATSAPP";
  if (config.provider !== "none") {
    const connection = await prisma.integrationAccount.findUnique({
      where: { workspaceId_provider_key: { workspaceId, provider, key: provider === "TWILIO" ? "whatsapp" : "default" } },
      select: { status: true }
    });
    if (connection?.status === "DISABLED") {
      throw new AppError(409, "CONFLICT", "WhatsApp is disabled for this workspace");
    }
  }
  if (config.nodeEnv !== "production" && config.e2eAllowedToNumbers.length > 0 &&
    !config.e2eAllowedToNumbers.some((number) => number.replace(/\D/gu, "") === to.replace(/\D/gu, ""))) {
    throw new AppError(409, "CONFLICT", "This number is not allowed for local WhatsApp testing");
  }
  let created = false;
  if (!outbound) {
    try {
      outbound = await prisma.outboundWhatsAppMessage.create({
        data: {
          workspaceId,
          leadId: conversation.leadId,
          contactId: conversation.lead.contactId,
          conversationId,
          provider,
          toWhatsAppId: to,
          normalizedToPhone: conversation.lead.contact.normalizedPhone,
          textBody: input.body,
          messageType: "text",
          senderType: "USER",
          idempotencyKey,
          status: "PROVIDER_PENDING"
        }
      });
      created = true;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      outbound = await prisma.outboundWhatsAppMessage.findUniqueOrThrow({ where: { idempotencyKey } });
    }
  }
  if (outbound.textBody !== input.body || outbound.workspaceId !== workspaceId) {
    throw new AppError(409, "CONFLICT", "This reply request was already used for another message");
  }
  if (created) {
    const result = await sendWhatsAppText(config, {
      to,
      body: input.body,
      idempotencyKey,
      replyToProviderMessageId: latestInbound?.providerMessageId
    }, options?.transport);
    if (result.status !== "ACCEPTED" || !result.providerMessageId) {
      if (result.status === "UNCERTAIN") {
        await prisma.outboundWhatsAppMessage.update({
          where: { id: outbound.id },
          data: {
            providerStatus: "unconfirmed",
            failureCode: "WHATSAPP_DELIVERY_UNCONFIRMED",
            failureMessage: result.lastError
          }
        });
        return { message: null, status: "PENDING", failureMessage: result.lastError };
      }
      await prisma.outboundWhatsAppMessage.update({
        where: { id: outbound.id },
        data: {
          status: result.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED",
          deliveryStatus: "FAILED",
          failureCode: result.status === "NOT_CONFIGURED" ? "WHATSAPP_NOT_CONFIGURED" : "WHATSAPP_PROVIDER_ERROR",
          failureMessage: result.lastError,
          failedAt: new Date()
        }
      });
      return { message: null, status: result.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", failureMessage: result.lastError };
    }
    outbound = await prisma.outboundWhatsAppMessage.update({
      where: { id: outbound.id },
      data: { providerMessageId: result.providerMessageId, providerStatus: result.providerStatus }
    });
  }
  if (!outbound.providerMessageId) {
    return {
      message: null,
      status: outbound.status === "FAILED" ? "FAILED" : outbound.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "PENDING",
      failureMessage: outbound.failureMessage
    };
  }
  const providerMessageId = outbound.providerMessageId;
  const saved = await prisma.$transaction(async (tx) => {
    const claimed = await tx.outboundWhatsAppMessage.updateMany({
      where: { id: outbound.id, status: "PROVIDER_PENDING", providerMessageId },
      data: { status: "SENT", deliveryStatus: "SENT", sentAt: new Date(), failureCode: null, failureMessage: null }
    });
    if (claimed.count === 0) return { activated: false };
    const message = await tx.message.upsert({
      where: { providerMessageId },
      create: {
        workspaceId,
        conversationId,
        providerMessageId,
        direction: "OUTBOUND",
        senderType: "USER",
        senderUserId: actor.id,
        body: input.body,
        deliveryStatus: "SENT",
        sentAt: new Date(),
        metadata: { outboundWhatsAppMessageId: outbound.id, source: "HUMAN_REPLY" }
      },
      update: {}
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: message.createdAt } });
    await tx.activity.create({
      data: {
        workspaceId,
        leadId: conversation.leadId,
        actorType: "USER",
        actorUserId: actor.id,
        sourceType: "CONVERSATION",
        sourceId: conversationId,
        type: "WHATSAPP_SENT",
        title: "WhatsApp reply sent",
        description: "A salesperson replied to the customer on WhatsApp.",
        visibility: "BUSINESS",
        correlationId: outbound.id
      }
    });
    const ownership = await completeHumanActionInTransaction({
      client: tx,
      leadId: conversation.leadId,
      reason: "HUMAN_REPLY_SENT",
      actorType: "USER",
      actorId: actor.id,
      sourceType: "CONVERSATION",
      sourceId: conversationId,
      correlationId: outbound.id
    });
    return ownership;
  }, { maxWait: 10_000, timeout: 30_000 });
  if (saved.activated) {
    await autoStartLeadAiAutomation(actor, conversation.leadId, {
      env: options?.env,
      provider: options?.aiProvider,
      cycleKey: `human-whatsapp:${outbound.id}`
    });
  }
  const message = await prisma.message.findUnique({
    where: { providerMessageId },
    include: { senderUser: true }
  });
  await publishConversationUpdate(conversation.leadId, conversationId, "human-whatsapp-reply-sent");
  return { message: message ? toMessageDto(message) : null, status: "SENT", failureMessage: null };
}

export async function updateConversationMode(
  actor: AuthenticatedUser,
  conversationId: string,
  input: UpdateConversationModeInput
): Promise<ConversationDto> {
  const existing = requireConversation(await findConversationById(conversationId));
  assertCanMutateLead(actor, existing.lead);
  const conversation = await updateConversationModeWithAudit({
    actorId: actor.id,
    conversationId,
    mode: input.mode,
    before: getModeSnapshot(existing),
    action: conversationEvents.modeChanged
  });

  if (input.mode === "AUTO" || input.mode === "DRAFT_ONLY") {
    const ownership = await completeHumanAction({
      leadId: existing.leadId,
      reason: "MANUAL_AUTOMATION_RESUME",
      actorType: "USER",
      actorId: actor.id,
      sourceType: "CONVERSATION",
      sourceId: conversationId,
      allowStoppedResume: input.mode === "AUTO"
    });
    if (ownership.activated) {
      await autoStartLeadAiAutomation(actor, existing.leadId, {
        cycleKey: `conversation-resume:${conversation.updatedAt.toISOString()}`
      });
    }
  } else if (input.mode === "HUMAN") {
    await activateHuman({
      leadId: existing.leadId,
      reason: "MANUAL_HUMAN_CONTROL",
      actorType: "USER",
      actorId: actor.id,
      sourceType: "CONVERSATION",
      sourceId: conversationId
    });
  } else {
    await stopAi({
      leadId: existing.leadId,
      reason: input.mode === "CLOSED" ? "CONVERSATION_CLOSED" : "MANUAL_PAUSE",
      actorType: "USER",
      actorId: actor.id,
      sourceType: "CONVERSATION",
      sourceId: conversationId
    });
  }

  await publishConversationUpdate(existing.leadId, conversationId, "conversation-mode-changed");
  return toConversationDto(conversation);
}

export async function startHumanTakeover(
  actor: AuthenticatedUser,
  conversationId: string,
  input: StartHumanTakeoverInput
): Promise<HumanTakeoverDto> {
  const existing = requireConversation(await findConversationById(conversationId));
  assertCanMutateLead(actor, existing.lead);
  if (existing.status === "CLOSED") {
    throw new AppError(409, "CONFLICT", "Cannot start human takeover on a closed conversation");
  }

  const active = await prisma.humanTakeover.findFirst({
    where: { conversationId, status: "ACTIVE" },
    include: { takenOverBy: true }
  });
  if (active) {
    if (existing.mode !== "HUMAN") {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { mode: "HUMAN" }
      });
    }
    await publishConversationUpdate(existing.leadId, conversationId, "human-takeover-started");
    return toHumanTakeoverDto(active);
  }

  const takeover = await prisma.$transaction(
    async (tx) => {
      await tx.conversation.update({
        where: { id: conversationId },
        data: { mode: "HUMAN" }
      });

      const created = await tx.humanTakeover.create({
        data: {
          leadId: existing.leadId,
          conversationId,
          takenOverByUserId: actor.id,
          reason: input.reason ?? null
        },
        include: { takenOverBy: true }
      });

      await tx.activity.create({
        data: {
          leadId: existing.leadId,
          actorUserId: actor.id,
          type: "HUMAN_TAKEOVER",
          description: input.reason
            ? `Human takeover started: ${input.reason}`
            : "Human takeover started"
        }
      });

      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: actor.id,
          entityType: "HumanTakeover",
          entityId: created.id,
          action: conversationEvents.humanTakeoverStarted,
          before: getModeSnapshot(existing),
          after: {
            id: created.id,
            leadId: created.leadId,
            conversationId: created.conversationId,
            takenOverByUserId: created.takenOverByUserId,
            status: created.status,
            reason: created.reason,
            conversationMode: "HUMAN"
          }
        }
      });

      await tx.lead.update({
        where: { id: existing.leadId },
        data: { lastActivityAt: new Date() }
      });

      return created;
    },
    { maxWait: 10000, timeout: 30000 }
  );

  await requireHumanAction({
    leadId: existing.leadId,
    reason: "HUMAN_TAKEOVER_STARTED",
    actorType: "USER",
    actorId: actor.id,
    sourceType: "HUMAN_TAKEOVER",
    sourceId: takeover.id
  });

  await publishConversationUpdate(existing.leadId, conversationId, "human-takeover-started");
  return toHumanTakeoverDto(takeover);
}

export async function getHumanTakeoverBriefing(
  actor: AuthenticatedUser,
  conversationId: string
): Promise<HumanTakeoverBriefingDto> {
  const conversation = requireConversation(await findConversationById(conversationId));
  assertCanAccessLead(actor, conversation.lead);
  const takeover = await prisma.humanTakeover.findFirst({
    where: { conversationId, status: "ACTIVE" },
    include: { takenOverBy: true },
    orderBy: { createdAt: "desc" }
  });
  if (!takeover) {
    throw new AppError(404, "NOT_FOUND", "Active human takeover not found");
  }

  const [recentMessages, qualification, proposals, deal, latestActions] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId },
      include: { senderUser: true },
      orderBy: { createdAt: "desc" },
      take: 8
    }),
    getQualification(conversation.leadId),
    listProposals({ leadId: conversation.leadId, limit: 10 }),
    conversation.workspaceId
      ? findDealByLeadId(conversation.leadId, conversation.workspaceId)
      : Promise.resolve(null),
    prisma.activity.findMany({
      where: { leadId: conversation.leadId },
      include: { actorUser: true },
      orderBy: { createdAt: "desc" },
      take: 10
    })
  ]);

  return {
    takeover: toHumanTakeoverDto(takeover),
    lead: toLeadDto(conversation.lead),
    requirements: {
      requirement: conversation.lead.requirement,
      serviceInterest: conversation.lead.serviceInterest,
      nextAction: conversation.lead.nextAction,
      nextActionAt: conversation.lead.nextActionAt?.toISOString() ?? null
    },
    conversationSummary: {
      conversationId: conversation.id,
      mode: conversation.mode,
      status: conversation.status,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      messageCount: await prisma.message.count({ where: { conversationId } }),
      recentMessages: recentMessages.reverse().map(toMessageDto)
    },
    qualification,
    proposalContext: { proposals },
    dealContext: { deal: deal ? toDealDto(deal) : null },
    latestActions: latestActions.map(toActivityDto)
  };
}
