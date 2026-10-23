import type { Request, Response } from "express";
import type {
  ConversationDto,
  HumanTakeoverBriefingDto,
  HumanTakeoverDto,
  HumanConversationReplyDto,
  HumanWhatsAppReplyDto,
  MessageDto
} from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { downloadConversationAttachment } from "./conversation-attachments.service.js";
import {
  appendMessage,
  createConversation,
  getConversation,
  getHumanTakeoverBriefing,
  listConversations,
  listMessages,
  sendHumanReply,
  sendHumanWhatsAppReply,
  startHumanTakeover,
  updateConversationMode
} from "./conversation.service.js";
import type {
  CreateConversationInput,
  CreateMessageInput,
  ListConversationsQuery,
  SendHumanReplyInput,
  StartHumanTakeoverInput,
  UpdateConversationModeInput
} from "./conversation.schemas.js";

function requireRequestUser(request: Request) {
  if (!request.user) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Authentication required");
  }

  return request.user;
}

export async function downloadConversationAttachmentController(
  request: Request<{ id: string; messageId: string; index: string }>,
  response: Response
): Promise<void> {
  response.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  const attachment = await downloadConversationAttachment(
    requireRequestUser(request),
    request.params.id,
    request.params.messageId,
    request.params.index
  );
  response
    .set({
      "Content-Type": attachment.contentType,
      "Content-Disposition": `attachment; filename="${attachment.fileName}"`,
      "Content-Length": String(attachment.bytes.length)
    })
    .status(200)
    .send(attachment.bytes);
}

export async function listConversationsController(
  request: Request,
  response: Response<ConversationDto[]>
): Promise<void> {
  response
    .status(200)
    .json(
      await listConversations(
        requireRequestUser(request),
        request.validatedQuery as ListConversationsQuery
      )
    );
}

export async function createConversationController(
  request: Request<Record<string, never>, ConversationDto, CreateConversationInput>,
  response: Response<ConversationDto>
): Promise<void> {
  response.status(201).json(await createConversation(requireRequestUser(request), request.body));
}

export async function getConversationController(
  request: Request<{ id: string }>,
  response: Response<ConversationDto>
): Promise<void> {
  response.status(200).json(await getConversation(requireRequestUser(request), request.params.id));
}

export async function listMessagesController(
  request: Request<{ id: string }>,
  response: Response<MessageDto[]>
): Promise<void> {
  response.status(200).json(await listMessages(requireRequestUser(request), request.params.id));
}

export async function appendMessageController(
  request: Request<{ id: string }, MessageDto, CreateMessageInput>,
  response: Response<MessageDto>
): Promise<void> {
  response
    .status(201)
    .json(await appendMessage(requireRequestUser(request), request.params.id, request.body));
}

export async function updateConversationModeController(
  request: Request<{ id: string }, ConversationDto, UpdateConversationModeInput>,
  response: Response<ConversationDto>
): Promise<void> {
  response
    .status(200)
    .json(
      await updateConversationMode(requireRequestUser(request), request.params.id, request.body)
    );
}

export async function startHumanTakeoverController(
  request: Request<{ id: string }, HumanTakeoverDto, StartHumanTakeoverInput>,
  response: Response<HumanTakeoverDto>
): Promise<void> {
  response
    .status(201)
    .json(await startHumanTakeover(requireRequestUser(request), request.params.id, request.body));
}

export async function sendHumanReplyController(
  request: Request<{ id: string }, HumanConversationReplyDto, SendHumanReplyInput>,
  response: Response<HumanConversationReplyDto>
): Promise<void> {
  response
    .status(200)
    .json(await sendHumanReply(requireRequestUser(request), request.params.id, request.body));
}

export async function sendHumanWhatsAppReplyController(
  request: Request<{ id: string }, HumanWhatsAppReplyDto, SendHumanReplyInput>,
  response: Response<HumanWhatsAppReplyDto>
): Promise<void> {
  response.status(200).json(await sendHumanWhatsAppReply(requireRequestUser(request), request.params.id, request.body));
}

export async function getHumanTakeoverBriefingController(
  request: Request<{ id: string }>,
  response: Response<HumanTakeoverBriefingDto>
): Promise<void> {
  response
    .status(200)
    .json(await getHumanTakeoverBriefing(requireRequestUser(request), request.params.id));
}
