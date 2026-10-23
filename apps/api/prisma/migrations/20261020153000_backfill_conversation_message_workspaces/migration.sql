UPDATE "Message" AS message
SET "workspaceId" = conversation."workspaceId"
FROM "Conversation" AS conversation
WHERE message."conversationId" = conversation."id"
  AND message."workspaceId" IS NULL
  AND conversation."workspaceId" IS NOT NULL;
