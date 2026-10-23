UPDATE "InternalNotification" AS notification
SET "workspaceId" = lead."workspaceId"
FROM "Lead" AS lead
WHERE notification."leadId" = lead."id"
  AND notification."workspaceId" IS NULL
  AND lead."workspaceId" IS NOT NULL;

UPDATE "InternalNotification" AS notification
SET "workspaceId" = meeting."workspaceId"
FROM "MeetingRequest" AS meeting
WHERE notification."meetingRequestId" = meeting."id"
  AND notification."workspaceId" IS NULL
  AND meeting."workspaceId" IS NOT NULL;
