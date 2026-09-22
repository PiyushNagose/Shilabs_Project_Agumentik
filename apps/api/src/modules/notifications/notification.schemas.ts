import { z } from "zod";

export const listNotificationsQuerySchema = z.object({
  leadId: z.string().optional(),
  status: z.enum(["UNREAD", "READ", "ATTENTION_REQUIRED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
