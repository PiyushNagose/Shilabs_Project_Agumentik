import type { Request, Response } from "express";
import type { ConversationDto, MessageDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import {
  appendMessage,
  createConversation,
  getConversation,
  listConversations,
  listMessages,
  updateConversationMode
} from "./conversation.service.js";
import type {
  CreateConversationInput,
  CreateMessageInput,
  ListConversationsQuery,
  UpdateConversationModeInput
} from "./conversation.schemas.js";

function requireRequestUser(request: Request) {
  if (!request.user) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Authentication required");
  }

  return request.user;
}

export async function listConversationsController(
  request: Request,
  response: Response<ConversationDto[]>
): Promise<void> {
  response
    .status(200)
    .json(await listConversations(request.validatedQuery as ListConversationsQuery));
}

export async function createConversationController(
  request: Request<Record<string, never>, ConversationDto, CreateConversationInput>,
  response: Response<ConversationDto>
): Promise<void> {
  response.status(201).json(await createConversation(request.body));
}

export async function getConversationController(
  request: Request<{ id: string }>,
  response: Response<ConversationDto>
): Promise<void> {
  response.status(200).json(await getConversation(request.params.id));
}

export async function listMessagesController(
  request: Request<{ id: string }>,
  response: Response<MessageDto[]>
): Promise<void> {
  response.status(200).json(await listMessages(request.params.id));
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
