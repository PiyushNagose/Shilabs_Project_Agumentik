import type {
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
