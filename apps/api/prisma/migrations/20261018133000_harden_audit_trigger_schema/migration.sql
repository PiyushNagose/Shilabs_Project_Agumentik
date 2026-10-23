CREATE OR REPLACE FUNCTION derive_activity_workspace() RETURNS TRIGGER AS $$
DECLARE
  trusted_workspace_id TEXT;
BEGIN
  EXECUTE format(
    'SELECT "workspaceId" FROM %I."Lead" WHERE "id" = $1',
    TG_TABLE_SCHEMA
  ) INTO trusted_workspace_id USING NEW."leadId";

  NEW."workspaceId" := COALESCE(trusted_workspace_id, NEW."workspaceId");
  NEW."entityId" := COALESCE(NEW."entityId", NEW."leadId");
  NEW."sourceType" := COALESCE(NEW."sourceType", 'DOMAIN_ACTIVITY');
  NEW."sourceId" := COALESCE(NEW."sourceId", NEW."entityId", NEW."leadId");
  NEW."title" := COALESCE(NEW."title", INITCAP(REPLACE(NEW."type"::TEXT, '_', ' ')));
  NEW."correlationId" := COALESCE(
    NEW."correlationId",
    MD5(NEW."id" || ':' || CLOCK_TIMESTAMP()::TEXT)
  );
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
    WHEN 'lead' THEN
      EXECUTE format(
        'SELECT "workspaceId" FROM %I."Lead" WHERE "id" = $1',
        TG_TABLE_SCHEMA
      ) INTO trusted_workspace_id USING NEW."entityId";
    WHEN 'task' THEN
      EXECUTE format(
        'SELECT "workspaceId" FROM %I."Task" WHERE "id" = $1',
        TG_TABLE_SCHEMA
      ) INTO trusted_workspace_id USING NEW."entityId";
    WHEN 'deal' THEN
      EXECUTE format(
        'SELECT "workspaceId" FROM %I."Deal" WHERE "id" = $1',
        TG_TABLE_SCHEMA
      ) INTO trusted_workspace_id USING NEW."entityId";
    ELSE
      trusted_workspace_id := NULL;
  END CASE;

  NEW."workspaceId" := COALESCE(trusted_workspace_id, NEW."workspaceId");
  NEW."actorUserId" := CASE
    WHEN NEW."actorType" = 'USER' THEN COALESCE(NEW."actorUserId", NEW."actorId")
    ELSE NEW."actorUserId"
  END;
  NEW."sourceType" := COALESCE(NEW."sourceType", 'APPLICATION');
  NEW."sourceId" := COALESCE(NEW."sourceId", NEW."entityId");
  NEW."correlationId" := COALESCE(
    NEW."correlationId",
    MD5(NEW."id" || ':' || CLOCK_TIMESTAMP()::TEXT)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
