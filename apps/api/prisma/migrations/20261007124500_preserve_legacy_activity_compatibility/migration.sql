CREATE OR REPLACE FUNCTION derive_activity_workspace() RETURNS TRIGGER AS $$
DECLARE
  trusted_workspace_id TEXT;
BEGIN
  SELECT "workspaceId" INTO trusted_workspace_id FROM "Lead" WHERE "id" = NEW."leadId";
  NEW."workspaceId" := trusted_workspace_id;
  NEW."entityId" := COALESCE(NEW."entityId", NEW."leadId");
  IF NEW."actorUserId" IS NOT NULL AND NEW."actorType" = 'SYSTEM' THEN
    NEW."actorType" := 'USER';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
