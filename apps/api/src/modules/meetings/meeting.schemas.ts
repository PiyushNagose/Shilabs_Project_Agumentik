import { z } from "zod";

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

const dateTimeSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const createMeetingRequestSchema = z
  .object({
    leadId: z.string().min(1).max(64),
    conversationId: z.string().min(1).max(64).optional(),
    ownerId: z.string().min(1).max(64).optional(),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(2000).optional(),
    timeZone: z.string().min(1).refine(isValidTimeZone, "timeZone must be a valid IANA time zone"),
    windowStart: dateTimeSchema,
    windowEnd: dateTimeSchema,
    durationMinutes: z.number().int().min(15).max(240).default(30),
    slotMinutes: z.number().int().min(15).max(240).optional(),
    meetingMode: z.enum(["VIDEO", "PHONE", "IN_PERSON"]).optional(),
    location: z.string().trim().min(3).max(500).optional(),
    reminderMinutes: z.number().int().min(0).max(10080).optional(),
    idempotencyKey: z.string().trim().min(8).max(160).optional()
  })
  .superRefine((value, context) => {
    if (value.windowEnd <= value.windowStart) {
      context.addIssue({
        code: "custom",
        path: ["windowEnd"],
        message: "windowEnd must be after windowStart"
      });
    }
    if (value.meetingMode && value.meetingMode !== "VIDEO" && !value.location) {
      context.addIssue({ code: "custom", path: ["location"], message: "Enter the phone number or meeting address" });
    }
  });

export const listMeetingRequestsQuerySchema = z.object({
  leadId: z.string().min(1).max(64).optional(),
  status: z
    .enum([
      "CONFIRMATION_REQUIRED",
      "PROVIDER_PENDING",
      "CONFIRMED",
      "ATTENTION_REQUIRED",
      "CANCELLED"
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const confirmMeetingRequestSchema = z.object({
  slotId: z.string().min(1).max(64),
  idempotencyKey: z.string().trim().min(8).max(160).optional()
});

export const cancelMeetingRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500)
});

export const meetingOutcomeSchema = z.object({
  outcome: z.enum(["COMPLETED", "NO_SHOW"]),
  notes: z.string().trim().min(5).max(5000),
  idempotencyKey: z.string().trim().min(8).max(160)
});

export const rescheduleMeetingSchema = z.object({
  startsAt: dateTimeSchema,
  endsAt: dateTimeSchema,
  reason: z.string().trim().min(3).max(500)
}).superRefine((value, context) => {
  if (value.endsAt <= value.startsAt) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "Meeting end must be after its start" });
  }
  if (value.startsAt.getTime() <= Date.now()) {
    context.addIssue({ code: "custom", path: ["startsAt"], message: "Choose a future meeting time" });
  }
  if (value.endsAt.getTime() - value.startsAt.getTime() > 240 * 60000) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "Meetings can be at most 4 hours long" });
  }
});

export type CreateMeetingRequestInput = z.infer<typeof createMeetingRequestSchema>;
export type ListMeetingRequestsQuery = z.infer<typeof listMeetingRequestsQuerySchema>;
export type ConfirmMeetingRequestInput = z.infer<typeof confirmMeetingRequestSchema>;
export type CancelMeetingRequestInput = z.infer<typeof cancelMeetingRequestSchema>;
export type MeetingOutcomeInput = z.infer<typeof meetingOutcomeSchema>;
export type RescheduleMeetingInput = z.infer<typeof rescheduleMeetingSchema>;
