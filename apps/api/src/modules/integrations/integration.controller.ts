import type { Request, Response } from "express";
import type { IntegrationConnectionDto, IntegrationDashboardDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import {
  integrationCatalogKeySchema,
  type ConnectIntegrationInput
} from "./integration.schemas.js";
import {
  connectIntegration,
  disableIntegration,
  disconnectIntegration,
  listIntegrations,
  reconnectIntegration
} from "./integration.service.js";

export async function listIntegrationsController(
  request: Request,
  response: Response<IntegrationDashboardDto>
): Promise<void> {
  response.status(200).json(await listIntegrations(getRequiredUser(request)));
}

export async function connectIntegrationController(
  request: Request<{ key: string }, IntegrationConnectionDto, ConnectIntegrationInput>,
  response: Response<IntegrationConnectionDto>
): Promise<void> {
  response
    .status(200)
    .json(
      await connectIntegration(
        getRequiredUser(request),
        integrationCatalogKeySchema.parse(request.params.key),
        request.body.displayName
      )
    );
}

export async function reconnectIntegrationController(
  request: Request<{ id: string }>,
  response: Response<IntegrationConnectionDto>
): Promise<void> {
  response
    .status(200)
    .json(await reconnectIntegration(getRequiredUser(request), request.params.id));
}

export async function disableIntegrationController(
  request: Request<{ id: string }>,
  response: Response<IntegrationConnectionDto>
): Promise<void> {
  response.status(200).json(await disableIntegration(getRequiredUser(request), request.params.id));
}

export async function disconnectIntegrationController(
  request: Request<{ id: string }>,
  response: Response
): Promise<void> {
  await disconnectIntegration(getRequiredUser(request), request.params.id);
  response.status(204).end();
}
