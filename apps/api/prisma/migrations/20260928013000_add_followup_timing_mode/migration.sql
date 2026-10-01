ALTER TABLE "FollowUpSequence"
ADD COLUMN "cadenceMode" TEXT NOT NULL DEFAULT 'PRODUCTION_DAYS',
ADD COLUMN "cadenceOffsetsMinutes" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

UPDATE "FollowUpSequence"
SET "cadenceOffsetsMinutes" = ARRAY[0, 1440, 7200, 12960]
WHERE cardinality("cadenceOffsetsMinutes") = 0;
