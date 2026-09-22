import { z } from "zod";
import {
  CONVERSATION_CHANNELS,
  CONVERSATION_MODES,
  MESSAGE_DELIVERY_STATUSES,
  MESSAGE_DIRECTIONS,
  MESSAGE_SENDER_TYPES
} from "@shilabs/shared-types";

export const conversationChannelSchema = z.enum(CONVERSATION_CHANNELS);
export const conversationModeSchema = z.enum(CONVERSATION_MODES);
export const messageDirectionSchema = z.enum(MESSAGE_DIRECTIONS);
export const messageSenderTypeSchema = z.enum(MESSAGE_SENDER_TYPES);
export const messageDeliveryStatusSchema = z.enum(MESSAGE_DELIVERY_STATUSES);

export const listConversationsQuerySchema = z.object({
  leadId: z.string().trim().min(1).optional(),
  channel: conversationChannelSchema.optional(),
  mode: conversationModeSchema.optional(),
  status: z.enum(["OPEN", "CLOSED"]).optional()
});

export const createConversationSchema = z.object({
  leadId: z.string().trim().min(1),
  channel: conversationChannelSchema,
  mode: conversationModeSchema.optional()
});

export const createMessageSchema = z.object({
  providerMessageId: z.string().trim().min(1).nullable().optional(),
  direction: messageDirectionSchema,
  senderType: messageSenderTypeSchema,
  senderUserId: z.string().trim().min(1).nullable().optional(),
  body: z.string().trim().min(1),
  deliveryStatus: messageDeliveryStatusSchema.optional(),
  sentAt: z.iso.datetime().nullable().optional(),
  deliveredAt: z.iso.datetime().nullable().optional(),
  readAt: z.iso.datetime().nullable().optional(),
  failedAt: z.iso.datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional()
});

export const updateConversationModeSchema = z.object({
  mode: conversationModeSchema
});

export const startHumanTakeoverSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional()
});

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type UpdateConversationModeInput = z.infer<typeof updateConversationModeSchema>;
export type StartHumanTakeoverInput = z.infer<typeof startHumanTakeoverSchema>;
