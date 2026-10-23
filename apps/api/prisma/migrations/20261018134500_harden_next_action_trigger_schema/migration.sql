CREATE OR REPLACE FUNCTION sync_lead_next_action_task() RETURNS TRIGGER AS $$
BEGIN
  PERFORM set_config(
    'search_path',
    quote_ident(TG_TABLE_SCHEMA) || ', pg_catalog',
    true
  );

  IF NEW."workspaceId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."nextAction" IS NULL THEN
    UPDATE "Task"
    SET "status" = 'COMPLETED',
        "completedAt" = COALESCE("completedAt", CURRENT_TIMESTAMP),
        "completedByType" = COALESCE("completedByType", 'SYSTEM'),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "projectionKey" = 'lead:' || NEW."id" || ':next-action'
      AND "status" IN ('OPEN', 'IN_PROGRESS');
  ELSE
    INSERT INTO "Task" (
      "id", "workspaceId", "title", "status", "priority", "dueAt", "assignedToUserId",
      "createdByType", "sourceType", "sourceId", "leadId", "isNextAction", "projectionKey",
      "createdAt", "updatedAt"
    ) VALUES (
      'legacy_next_action_' || MD5(NEW."id"), NEW."workspaceId", NEW."nextAction", 'OPEN',
      'NORMAL', NEW."nextActionAt", NEW."ownerId", 'SYSTEM', 'LEGACY_NEXT_ACTION', NEW."id",
      NEW."id", true, 'lead:' || NEW."id" || ':next-action', CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("projectionKey") DO UPDATE SET
      "workspaceId" = EXCLUDED."workspaceId",
      "title" = EXCLUDED."title",
      "status" = 'OPEN',
      "dueAt" = EXCLUDED."dueAt",
      "assignedToUserId" = EXCLUDED."assignedToUserId",
      "completedAt" = NULL,
      "completedByType" = NULL,
      "completedByUserId" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
