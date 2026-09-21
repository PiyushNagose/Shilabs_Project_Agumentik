import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

const conversationInclude = {
  lead: {
    include: {
      company: true,
      contact: true,
      owner: true,
      stage: true
    }
  }
} satisfies Prisma.ConversationInclude;

const messageInclude = {
  senderUser: true
} satisfies Prisma.MessageInclude;

export type ConversationRecord = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;
export type MessageRecord = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export async function listConversationRecords(
  where: Prisma.ConversationWhereInput
): Promise<ConversationRecord[]> {
  return prisma.conversation.findMany({
    where,
    include: conversationInclude,
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
  });
}

export async function findConversationById(id: string): Promise<ConversationRecord | null> {
  return prisma.conversation.findUnique({
    where: { id },
    include: conversationInclude
  });
}

export async function createConversationRecord(
  data: Prisma.ConversationCreateInput
): Promise<ConversationRecord> {
  return prisma.conversation.create({
    data,
    include: conversationInclude
  });
}

export async function listMessages(conversationId: string): Promise<MessageRecord[]> {
  return prisma.message.findMany({
    where: { conversationId },
    include: messageInclude,
    orderBy: { createdAt: "asc" }
  });
}

export async function appendMessageWithConversationUpdate(input: {
  conversationId: string;
  leadId: string;
  message: Prisma.MessageCreateInput;
  lastMessageAt: Date;
  activity: {
    type: Prisma.ActivityCreateInput["type"];
    description: string;
    actorUserId: string | null;
  };
}): Promise<MessageRecord> {
  return prisma.$transaction(
    async (transaction) => {
      const message = await transaction.message.create({
        data: input.message,
        include: messageInclude
      });

      await transaction.conversation.update({
        where: { id: input.conversationId },
        data: {
          lastMessageAt: input.lastMessageAt
        }
      });

      await transaction.activity.create({
        data: {
          lead: { connect: { id: input.leadId } },
          actorUser: input.activity.actorUserId
            ? { connect: { id: input.activity.actorUserId } }
            : undefined,
          type: input.activity.type,
          description: input.activity.description
        }
      });

      await transaction.lead.update({
        where: { id: input.leadId },
        data: {
          lastActivityAt: input.lastMessageAt
        }
      });

      return message;
    },
    { maxWait: 10000, timeout: 30000 }
  );
}

export async function updateConversationModeWithAudit(input: {
  conversationId: string;
  mode: Prisma.ConversationUpdateInput["mode"];
  actorId: string;
  before: Prisma.InputJsonValue;
  action: string;
}): Promise<ConversationRecord> {
  return prisma.$transaction(
    async (transaction) => {
      const conversation = await transaction.conversation.update({
        where: { id: input.conversationId },
        data: {
          mode: input.mode,
          status: input.mode === "CLOSED" ? "CLOSED" : undefined
        },
        include: conversationInclude
      });

      await transaction.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actorId,
          entityType: "Conversation",
          entityId: conversation.id,
          action: input.action,
          before: input.before,
          after: {
            id: conversation.id,
            mode: conversation.mode,
            status: conversation.status
          }
        }
      });

      return conversation;
    },
    { maxWait: 10000, timeout: 30000 }
  );
}
