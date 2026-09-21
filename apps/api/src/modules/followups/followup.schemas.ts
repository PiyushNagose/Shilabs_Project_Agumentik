import { z } from "zod";

export const startFollowUpSequenceSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200).optional()
});

export type StartFollowUpSequenceInput = z.infer<typeof startFollowUpSequenceSchema>;
