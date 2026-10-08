import type {
  AgentComposerDefinitionDto,
  AgentComposerPreviewDto,
  AgentComposerValidationDto,
  AgentDashboardDto,
  AgentDetailDto,
  AgentStatusName,
  AgentTypeName
} from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export interface AgentBody {
  name: string;
  description: string;
  type: AgentTypeName;
  definition?: Record<string, unknown>;
  modelConfig?: Record<string, unknown> | null;
  toolsConfig?: Record<string, unknown> | null;
  knowledgeConfig?: Record<string, unknown> | null;
}

export function listAgents(accessToken: string): Promise<AgentDashboardDto> {
  return apiRequest<AgentDashboardDto>("/api/agents", accessToken);
}

export function getAgent(accessToken: string, agentId: string): Promise<AgentDetailDto> {
  return apiRequest<AgentDetailDto>(`/api/agents/${agentId}`, accessToken);
}

export function createAgent(accessToken: string, body: AgentBody): Promise<AgentDetailDto> {
  return apiRequest<AgentDetailDto>("/api/agents", accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function updateAgent(
  accessToken: string,
  agentId: string,
  body: Partial<Omit<AgentBody, "type">>
): Promise<AgentDetailDto> {
  return apiRequest<AgentDetailDto>(`/api/agents/${agentId}`, accessToken, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function updateAgentStatus(
  accessToken: string,
  agentId: string,
  status: Exclude<AgentStatusName, "DRAFT">
): Promise<AgentDetailDto> {
  return apiRequest<AgentDetailDto>(`/api/agents/${agentId}/status`, accessToken, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function saveAgentComposer(
  accessToken: string,
  agentId: string,
  definition: AgentComposerDefinitionDto
): Promise<AgentDetailDto> {
  return apiRequest<AgentDetailDto>(`/api/agents/${agentId}/composer`, accessToken, {
    method: "PUT",
    body: JSON.stringify({ definition })
  });
}

export function validateAgentComposer(
  accessToken: string,
  agentId: string
): Promise<AgentComposerValidationDto> {
  return apiRequest<AgentComposerValidationDto>(
    `/api/agents/${agentId}/composer/validate`,
    accessToken,
    { method: "POST" }
  );
}

export function previewAgentComposer(
  accessToken: string,
  agentId: string,
  definition: AgentComposerDefinitionDto
): Promise<AgentComposerPreviewDto> {
  return apiRequest<AgentComposerPreviewDto>(
    `/api/agents/${agentId}/composer/preview`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({ definition })
    }
  );
}

export function publishAgentComposer(
  accessToken: string,
  agentId: string
): Promise<AgentDetailDto> {
  return apiRequest<AgentDetailDto>(`/api/agents/${agentId}/composer/publish`, accessToken, {
    method: "POST"
  });
}
