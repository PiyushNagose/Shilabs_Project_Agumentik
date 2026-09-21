export const conversationEvents = {
  created: "CONVERSATION_CREATED",
  modeChanged: "AI_MODE_CHANGED"
} as const;

export const messageEvents = {
  received: "MESSAGE_RECEIVED",
  sent: "MESSAGE_SENT"
} as const;
