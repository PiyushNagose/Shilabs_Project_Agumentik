import type { Request, Response } from "express";
import type { InternalNotificationDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import type {
  AcknowledgeNotificationInput,
  EscalateNotificationInput,
  ListNotificationsQuery
} from "./notification.schemas.js";
import {
  acknowledgeNotification,
  escalateNotification,
  listNotifications,
  markNotificationRead
} from "./notification.service.js";

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

export async function markNotificationReadController(
  request: Request<{ id: string }>,
  response: Response<InternalNotificationDto>
): Promise<void> {
  response.status(200).json(await markNotificationRead(getRequiredUser(request), request.params.id));
}

export async function acknowledgeNotificationController(
  request: Request<{ id: string }, InternalNotificationDto, AcknowledgeNotificationInput>,
  response: Response<InternalNotificationDto>
): Promise<void> {
  response
    .status(200)
    .json(await acknowledgeNotification(getRequiredUser(request), request.params.id, request.body));
}

export async function escalateNotificationController(
  request: Request<{ id: string }, InternalNotificationDto, EscalateNotificationInput>,
  response: Response<InternalNotificationDto>
): Promise<void> {
  response
    .status(200)
    .json(await escalateNotification(getRequiredUser(request), request.params.id, request.body));
}
