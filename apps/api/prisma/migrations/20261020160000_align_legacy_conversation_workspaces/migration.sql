UPDATE "Conversation" AS conversation
SET "workspaceId" = lead."workspaceId"
FROM "Lead" AS lead
WHERE conversation."leadId" = lead."id"
  AND conversation."workspaceId" IS NULL
  AND lead."workspaceId" IS NOT NULL;

UPDATE "Message" AS message
SET "workspaceId" = conversation."workspaceId"
FROM "Conversation" AS conversation
WHERE message."conversationId" = conversation."id"
  AND message."workspaceId" IS NULL
  AND conversation."workspaceId" IS NOT NULL;
