import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  appendMessageController,
  createConversationController,
  getConversationController,
  listConversationsController,
  listMessagesController,
  updateConversationModeController
} from "./conversation.controller.js";
import {
  createConversationSchema,
  createMessageSchema,
  listConversationsQuerySchema,
  updateConversationModeSchema
} from "./conversation.schemas.js";

export const conversationRoutes = Router();

conversationRoutes.use(requireAuth);
conversationRoutes.get(
  "/",
  validateQuery(listConversationsQuerySchema),
  asyncHandler(listConversationsController)
);
conversationRoutes.post(
  "/",
  validateBody(createConversationSchema),
  asyncHandler(createConversationController)
);
conversationRoutes.get("/:id/messages", asyncHandler(listMessagesController));
conversationRoutes.post(
  "/:id/messages",
  validateBody(createMessageSchema),
  asyncHandler(appendMessageController)
);
conversationRoutes.patch(
  "/:id/mode",
  validateBody(updateConversationModeSchema),
  asyncHandler(updateConversationModeController)
);
conversationRoutes.get("/:id", asyncHandler(getConversationController));
