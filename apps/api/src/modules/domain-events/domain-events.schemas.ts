import { z } from "zod";

export const listDomainEventsQuerySchema = z.object({
  status: z
    .enum(["PENDING", "QUEUED", "PROCESSING", "PROCESSED", "FAILED", "ATTENTION_REQUIRED"])
    .optional(),
  eventType: z.string().trim().min(1).max(160).optional(),
  aggregateType: z.string().trim().min(1).max(80).optional(),
  aggregateId: z.string().trim().min(1).max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export type ListDomainEventsQuery = z.infer<typeof listDomainEventsQuerySchema>;
