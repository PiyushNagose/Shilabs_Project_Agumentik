import type { Request, Response } from "express";
import type { DomainEventOutboxDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import type { ListDomainEventsQuery } from "./domain-events.schemas.js";
import { listDomainEvents, retryDomainEvent } from "./domain-events.service.js";

export async function listDomainEventsController(
  request: Request,
  response: Response<DomainEventOutboxDto[]>
): Promise<void> {
  response.status(200).json(
    await listDomainEvents(getRequiredUser(request), request.validatedQuery as ListDomainEventsQuery)
  );
}

export async function retryDomainEventController(
  request: Request<{ id: string }>,
  response: Response<DomainEventOutboxDto>
): Promise<void> {
  response.status(200).json(await retryDomainEvent(getRequiredUser(request), request.params.id));
}
