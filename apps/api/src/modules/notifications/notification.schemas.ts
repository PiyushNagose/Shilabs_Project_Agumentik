import { z } from "zod";
import { INTERNAL_NOTIFICATION_STATUSES } from "@shilabs/shared-types";

export const listNotificationsQuerySchema = z.object({
  leadId: z.string().optional(),
  status: z.enum(INTERNAL_NOTIFICATION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const acknowledgeNotificationSchema = z.object({
  note: z.string().trim().max(1000).optional()
});

export const escalateNotificationSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
  escalationDueAt: z.iso.datetime({ offset: true }).optional()
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type AcknowledgeNotificationInput = z.infer<typeof acknowledgeNotificationSchema>;
export type EscalateNotificationInput = z.infer<typeof escalateNotificationSchema>;
