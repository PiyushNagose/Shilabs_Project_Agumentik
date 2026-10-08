import type { Request, Response } from "express";
import type {
  AgentComposerPreviewDto,
  AgentComposerValidationDto,
  AgentDashboardDto,
  AgentDetailDto
} from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  updateAgentStatus
} from "./agent.service.js";
import type {
  PreviewAgentComposerInput,
  SaveAgentComposerInput,
  CreateAgentInput,
  ListAgentExecutionsQuery,
  UpdateAgentInput,
  UpdateAgentStatusInput
} from "./agent.schemas.js";
import {
  previewAgentComposer,
  publishAgentComposer,
  saveAgentComposer,
  validateAgentComposer
} from "./agent-composer.service.js";

export async function listAgentsController(
  request: Request,
  response: Response<AgentDashboardDto>
): Promise<void> {
  response.status(200).json(await listAgents(getRequiredUser(request)));
}

export async function getAgentController(
  request: Request<{ id: string }>,
  response: Response<AgentDetailDto>
): Promise<void> {
  response
    .status(200)
    .json(
      await getAgent(
        getRequiredUser(request),
        request.params.id,
        request.validatedQuery as ListAgentExecutionsQuery
      )
    );
}

export async function createAgentController(
  request: Request<Record<string, never>, AgentDetailDto, CreateAgentInput>,
  response: Response<AgentDetailDto>
): Promise<void> {
  response.status(201).json(await createAgent(getRequiredUser(request), request.body));
}

export async function updateAgentController(
  request: Request<{ id: string }, AgentDetailDto, UpdateAgentInput>,
  response: Response<AgentDetailDto>
): Promise<void> {
  response
    .status(200)
    .json(await updateAgent(getRequiredUser(request), request.params.id, request.body));
}

export async function updateAgentStatusController(
  request: Request<{ id: string }, AgentDetailDto, UpdateAgentStatusInput>,
  response: Response<AgentDetailDto>
): Promise<void> {
  response
    .status(200)
    .json(await updateAgentStatus(getRequiredUser(request), request.params.id, request.body));
}

export async function saveAgentComposerController(
  request: Request<{ id: string }, AgentDetailDto, SaveAgentComposerInput>,
  response: Response<AgentDetailDto>
): Promise<void> {
  response
    .status(200)
    .json(
      await saveAgentComposer(getRequiredUser(request), request.params.id, request.body.definition)
    );
}

export async function validateAgentComposerController(
  request: Request<{ id: string }>,
  response: Response<AgentComposerValidationDto>
): Promise<void> {
  response
    .status(200)
    .json(await validateAgentComposer(getRequiredUser(request), request.params.id));
}

export async function previewAgentComposerController(
  request: Request<{ id: string }, AgentComposerPreviewDto, PreviewAgentComposerInput>,
  response: Response<AgentComposerPreviewDto>
): Promise<void> {
  response
    .status(200)
    .json(await previewAgentComposer(getRequiredUser(request), request.params.id, request.body));
}

export async function publishAgentComposerController(
  request: Request<{ id: string }>,
  response: Response<AgentDetailDto>
): Promise<void> {
  response
    .status(200)
    .json(await publishAgentComposer(getRequiredUser(request), request.params.id));
}
