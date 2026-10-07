import { Prisma } from "@prisma/client";
import type {
  ActivityDto,
  ConversationDto,
  HumanTakeoverBriefingDto,
  HumanTakeoverDto,
  HumanConversationReplyDto,
  MessageDto
} from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { toDealDto } from "../deals/deal.service.js";
import { sendOutboundEmail } from "../email/email.service.js";
import type { EmailProvider } from "../email/email.provider.js";
import { appendActivityToZohoTimeline } from "../integrations/zoho-bigin/zoho-bigin-timeline.service.js";
import { findDealByLeadId } from "../deals/deal.repository.js";
import { findLeadById } from "../leads/lead.repository.js";
import {
  assertCanAccessLead,
  assertCanMutateLead,
  leadVisibilityWhere
} from "../leads/lead.permissions.js";
import { toLeadDto } from "../leads/lead.service.js";
import { listProposals } from "../proposals/proposal.service.js";
import { getQualification } from "../qualification/qualification.service.js";
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
    createdAt: message.createdAt.toISOString(),
    senderUser: message.senderUser ? toPublicUser(message.senderUser) : null
  };
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
  if (actor.role === "ADMIN" || actor.role === "SALES_MANAGER") return;
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
    lead: { connect: { id: lead.id } },
    channel: input.channel,
    mode: input.mode
  });

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
  if (conversation.mode !== "HUMAN") {
    throw new AppError(409, "CONFLICT", "Human replies require conversation mode HUMAN");
  }
  assertHumanReplyActor(actor, conversation);

  const subject = input.subject ?? defaultHumanReplySubject(conversation);
  const idempotencyKey = `human-reply:${conversation.id}:${input.idempotencyKey}`;
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

  return { outboundEmail, message: toMessageDto(message), zohoTimeline };
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
    findDealByLeadId(conversation.leadId),
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
