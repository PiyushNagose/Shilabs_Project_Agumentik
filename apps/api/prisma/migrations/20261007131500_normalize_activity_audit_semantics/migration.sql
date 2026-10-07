UPDATE "Activity"
SET "sourceType" = COALESCE("sourceType", 'DOMAIN_ACTIVITY'),
    "sourceId" = COALESCE("sourceId", "entityId", "leadId"),
    "title" = COALESCE("title", INITCAP(REPLACE("type"::TEXT, '_', ' '))),
    "correlationId" = COALESCE("correlationId", MD5("id" || ':' || "createdAt"::TEXT));

UPDATE "AuditEvent"
SET "sourceType" = COALESCE("sourceType", 'APPLICATION'),
    "sourceId" = COALESCE("sourceId", "entityId"),
    "correlationId" = COALESCE("correlationId", MD5("id" || ':' || "createdAt"::TEXT));

CREATE OR REPLACE FUNCTION derive_activity_workspace() RETURNS TRIGGER AS $$
DECLARE
  trusted_workspace_id TEXT;
BEGIN
  SELECT "workspaceId" INTO trusted_workspace_id FROM "Lead" WHERE "id" = NEW."leadId";
  NEW."workspaceId" := trusted_workspace_id;
  NEW."entityId" := COALESCE(NEW."entityId", NEW."leadId");
  NEW."sourceType" := COALESCE(NEW."sourceType", 'DOMAIN_ACTIVITY');
  NEW."sourceId" := COALESCE(NEW."sourceId", NEW."entityId", NEW."leadId");
  NEW."title" := COALESCE(NEW."title", INITCAP(REPLACE(NEW."type"::TEXT, '_', ' ')));
  NEW."correlationId" := COALESCE(NEW."correlationId", MD5(NEW."id" || ':' || CLOCK_TIMESTAMP()::TEXT));
  IF NEW."actorUserId" IS NOT NULL AND NEW."actorType" = 'SYSTEM' THEN
    NEW."actorType" := 'USER';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION derive_audit_workspace() RETURNS TRIGGER AS $$
DECLARE
  trusted_workspace_id TEXT;
BEGIN
  CASE LOWER(NEW."entityType")
    WHEN 'lead' THEN SELECT "workspaceId" INTO trusted_workspace_id FROM "Lead" WHERE "id" = NEW."entityId";
    WHEN 'task' THEN SELECT "workspaceId" INTO trusted_workspace_id FROM "Task" WHERE "id" = NEW."entityId";
    WHEN 'deal' THEN SELECT "workspaceId" INTO trusted_workspace_id FROM "Deal" WHERE "id" = NEW."entityId";
    ELSE trusted_workspace_id := NULL;
  END CASE;
  IF trusted_workspace_id IS NOT NULL THEN
    NEW."workspaceId" := trusted_workspace_id;
  END IF;
  NEW."actorUserId" := CASE
    WHEN NEW."actorType" = 'USER' THEN COALESCE(NEW."actorUserId", NEW."actorId")
    ELSE NEW."actorUserId"
  END;
  NEW."sourceType" := COALESCE(NEW."sourceType", 'APPLICATION');
  NEW."sourceId" := COALESCE(NEW."sourceId", NEW."entityId");
  NEW."correlationId" := COALESCE(NEW."correlationId", MD5(NEW."id" || ':' || CLOCK_TIMESTAMP()::TEXT));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
