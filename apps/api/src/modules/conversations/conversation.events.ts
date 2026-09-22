export const conversationEvents = {
  created: "CONVERSATION_CREATED",
  modeChanged: "AI_MODE_CHANGED",
  humanTakeoverStarted: "HUMAN_TAKEOVER_STARTED"
} as const;

export const messageEvents = {
  received: "MESSAGE_RECEIVED",
  sent: "MESSAGE_SENT"
} as const;
