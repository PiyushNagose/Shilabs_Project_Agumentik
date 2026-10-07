CREATE OR REPLACE FUNCTION derive_activity_workspace() RETURNS TRIGGER AS $$
DECLARE
  trusted_workspace_id TEXT;
BEGIN
  SELECT "workspaceId" INTO trusted_workspace_id FROM "Lead" WHERE "id" = NEW."leadId";
  IF trusted_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Activity requires a workspace-scoped lead';
  END IF;
  NEW."workspaceId" := trusted_workspace_id;
  NEW."entityId" := COALESCE(NEW."entityId", NEW."leadId");
  IF NEW."actorUserId" IS NOT NULL AND NEW."actorType" = 'SYSTEM' THEN
    NEW."actorType" := 'USER';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Activity_derive_workspace"
BEFORE INSERT OR UPDATE OF "leadId", "workspaceId" ON "Activity"
FOR EACH ROW EXECUTE FUNCTION derive_activity_workspace();

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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_derive_workspace"
BEFORE INSERT OR UPDATE OF "entityType", "entityId", "workspaceId" ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION derive_audit_workspace();
