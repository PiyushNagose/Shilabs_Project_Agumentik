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

export type CreateMeetingRequestInput = z.infer<typeof createMeetingRequestSchema>;
export type ListMeetingRequestsQuery = z.infer<typeof listMeetingRequestsQuerySchema>;
export type ConfirmMeetingRequestInput = z.infer<typeof confirmMeetingRequestSchema>;
