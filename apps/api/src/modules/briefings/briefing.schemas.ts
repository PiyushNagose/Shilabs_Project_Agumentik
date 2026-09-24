import { z } from "zod";
import { BRIEFING_KINDS, BRIEFING_RUN_STATUSES } from "@shilabs/shared-types";

export const listBriefingsQuerySchema = z.object({
  leadId: z.string().trim().min(1).max(64).optional(),
  meetingRequestId: z.string().trim().min(1).max(64).optional(),
  kind: z.enum(BRIEFING_KINDS).optional(),
  status: z.enum(BRIEFING_RUN_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const generateBriefingSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(160).optional()
});

export type ListBriefingsQuery = z.infer<typeof listBriefingsQuerySchema>;
export type GenerateBriefingInput = z.infer<typeof generateBriefingSchema>;
