import type { InternalNotificationDto } from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export interface EscalateNotificationBody {
  reason: string;
  escalationDueAt?: string;
}

export function escalateNotification(
  accessToken: string,
  notificationId: string,
  body: EscalateNotificationBody
): Promise<InternalNotificationDto> {
  return apiRequest(
    `/api/notifications/${encodeURIComponent(notificationId)}/escalate`,
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify(body)
    }
  );
}
