CREATE TYPE "LeadAutomationOwnershipState" AS ENUM (
  'HUMAN_ACTIVE',
  'HUMAN_ACTION_COMPLETED',
  'AI_ACTIVE',
  'AI_STOPPED',
  'HUMAN_REQUIRED'
);

ALTER TABLE "Lead"
ADD COLUMN "automationOwnershipState" "LeadAutomationOwnershipState" NOT NULL DEFAULT 'HUMAN_ACTIVE',
ADD COLUMN "automationOwnershipChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "automationOwnershipReason" TEXT;

UPDATE "Lead" AS lead
SET
  "automationOwnershipState" = CASE
    WHEN lead."status" IN ('WON', 'LOST', 'DISQUALIFIED')
      OR EXISTS (
        SELECT 1 FROM "Contact" AS contact
        WHERE contact."id" = lead."contactId" AND contact."doNotContact" = true
      ) THEN 'AI_STOPPED'::"LeadAutomationOwnershipState"
    WHEN EXISTS (
      SELECT 1 FROM "HumanTakeover" AS takeover
      WHERE takeover."leadId" = lead."id" AND takeover."status" = 'ACTIVE'
    ) OR EXISTS (
      SELECT 1 FROM "Conversation" AS conversation
      WHERE conversation."leadId" = lead."id" AND conversation."mode" = 'HUMAN'
    ) THEN 'HUMAN_REQUIRED'::"LeadAutomationOwnershipState"
    WHEN EXISTS (
      SELECT 1 FROM "FollowUpSequence" AS follow_up
      WHERE follow_up."leadId" = lead."id" AND follow_up."status" = 'ACTIVE'
    ) OR EXISTS (
      SELECT 1 FROM "CallingSequence" AS calling
      WHERE calling."leadId" = lead."id" AND calling."status" = 'ACTIVE'
    ) THEN 'AI_ACTIVE'::"LeadAutomationOwnershipState"
    ELSE 'HUMAN_ACTIVE'::"LeadAutomationOwnershipState"
  END,
  "automationOwnershipReason" = 'PHASE_7_5_MIGRATION';

CREATE INDEX "Lead_automationOwnershipState_idx" ON "Lead"("automationOwnershipState");

ALTER TYPE "ActivityType" ADD VALUE 'AUTOMATION_OWNERSHIP_CHANGED';
