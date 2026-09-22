import type { Request, Response } from "express";
import type { InternalNotificationDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import type { ListNotificationsQuery } from "./notification.schemas.js";
import { listNotifications } from "./notification.service.js";

export async function listNotificationsController(
  request: Request,
  response: Response<InternalNotificationDto[]>
): Promise<void> {
  response
    .status(200)
    .json(
      await listNotifications(
        getRequiredUser(request),
        request.validatedQuery as ListNotificationsQuery
      )
    );
}
