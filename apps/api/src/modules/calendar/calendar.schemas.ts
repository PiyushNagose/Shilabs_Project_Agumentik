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

export const calendarAvailabilitySchema = z
  .object({
    ownerUserId: z.string().min(1).max(64),
    timeZone: z.string().min(1).refine(isValidTimeZone, "timeZone must be a valid IANA time zone"),
    windowStart: dateTimeSchema,
    windowEnd: dateTimeSchema,
    slotMinutes: z.number().int().min(15).max(240).optional()
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

export type CalendarAvailabilityInput = z.infer<typeof calendarAvailabilitySchema>;
