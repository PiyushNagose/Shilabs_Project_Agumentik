import { Prisma } from "@prisma/client";
import type {
  ActivityDto,
  ConversationDto,
  HumanTakeoverBriefingDto,
  HumanTakeoverDto,
  MessageDto
} from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { toDealDto } from "../deals/deal.service.js";
import { findDealByLeadId } from "../deals/deal.repository.js";
import { findLeadById } from "../leads/lead.repository.js";
import { toLeadDto } from "../leads/lead.service.js";
import { listProposals } from "../proposals/proposal.service.js";
import { getQualification } from "../qualification/qualification.service.js";
import { conversationEvents, messageEvents } from "./conversation.events.js";
import type {
  CreateConversationInput,
  CreateMessageInput,
  ListConversationsQuery,
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
    actorUserId: activity.actorUserId,
    type: activity.type,
    description: activity.description,
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

export async function createConversation(input: CreateConversationInput): Promise<ConversationDto> {
  const lead = await findLeadById(input.leadId);
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }

  const conversation = await createConversationRecord({
    lead: { connect: { id: lead.id } },
    channel: input.channel,
    mode: input.mode
  });

  return toConversationDto(conversation);
}

export async function listConversations(query: ListConversationsQuery): Promise<ConversationDto[]> {
  return (
    await listConversationRecords({
      leadId: query.leadId,
      channel: query.channel,
      mode: query.mode,
      status: query.status
    })
  ).map(toConversationDto);
}

export async function getConversation(conversationId: string): Promise<ConversationDto> {
  return toConversationDto(requireConversation(await findConversationById(conversationId)));
}

export async function listMessages(conversationId: string): Promise<MessageDto[]> {
  requireConversation(await findConversationById(conversationId));
  return (await listMessageRecords(conversationId)).map(toMessageDto);
}

export async function appendMessage(
  actor: AuthenticatedUser,
  conversationId: string,
  input: CreateMessageInput
): Promise<MessageDto> {
  const conversation = requireConversation(await findConversationById(conversationId));
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

export async function updateConversationMode(
  actor: AuthenticatedUser,
  conversationId: string,
  input: UpdateConversationModeInput
): Promise<ConversationDto> {
  const existing = requireConversation(await findConversationById(conversationId));
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
  conversationId: string
): Promise<HumanTakeoverBriefingDto> {
  const conversation = requireConversation(await findConversationById(conversationId));
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
