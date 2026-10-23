ALTER TABLE "MeetingRequest"
  ADD COLUMN "meetingMode" TEXT NOT NULL DEFAULT 'VIDEO',
  ADD COLUMN "location" TEXT,
  ADD COLUMN "reminderMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "reminderSentAt" TIMESTAMP(3),
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "outcomeNotes" TEXT,
  ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "MeetingRequest"
  ADD CONSTRAINT "MeetingRequest_meetingMode_check" CHECK ("meetingMode" IN ('VIDEO', 'PHONE', 'IN_PERSON')),
  ADD CONSTRAINT "MeetingRequest_reminderMinutes_check" CHECK ("reminderMinutes" BETWEEN 0 AND 10080),
  ADD CONSTRAINT "MeetingRequest_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('COMPLETED', 'NO_SHOW'));
