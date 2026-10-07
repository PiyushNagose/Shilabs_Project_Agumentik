import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler.js";
import { AppError } from "../../shared/errors.js";
import { isInternalRealtimePublishAuthorized, publishRealtimeEvent } from "./realtime.service.js";

const realtimeEventSchema = z.object({
  entityType: z.enum([
    "workspace",
    "lead",
    "task",
    "activity",
    "dashboard",
    "operations",
    "notifications",
    "domain-event"
  ]),
  action: z.string().trim().min(1),
  leadId: z.string().trim().min(1).nullable().optional(),
  conversationId: z.string().trim().min(1).nullable().optional(),
  domainEventId: z.string().trim().min(1).nullable().optional(),
  sourceEventType: z.string().trim().min(1).nullable().optional(),
  taskId: z.string().trim().min(1).nullable().optional()
});

export const realtimeRoutes = Router();

realtimeRoutes.post(
  "/internal/events",
  asyncHandler(async (request, response) => {
    const secret = request.header("x-shilabs-realtime-secret");
    if (!isInternalRealtimePublishAuthorized(secret)) {
      throw new AppError(401, "AUTHENTICATION_ERROR", "Realtime publish is not authorized");
    }
    const parsed = realtimeEventSchema.parse(request.body);
    await publishRealtimeEvent({
      entityType: parsed.entityType,
      action: parsed.action,
      leadId: parsed.leadId ?? null,
      conversationId: parsed.conversationId ?? null,
      domainEventId: parsed.domainEventId ?? null,
      sourceEventType: parsed.sourceEventType ?? null,
      taskId: parsed.taskId ?? null
    });
    response.status(202).json({ accepted: true });
  })
);
