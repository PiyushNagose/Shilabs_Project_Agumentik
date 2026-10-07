import type { DealDto, PaginatedResponse, PipelineDto, PipelineStageDto } from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export interface DealListParams {
  pipelineId?: string;
  stageId?: string;
  ownerId?: string;
  status?: "OPEN" | "WON" | "LOST";
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface DealBody {
  leadId?: string;
  stageId?: string;
  ownerId?: string | null;
  value?: string | null;
  currency?: string;
  probability?: number;
  status?: "OPEN" | "WON" | "LOST";
  closeDate?: string | null;
  wonReason?: string | null;
  lostReason?: string | null;
}

function query(params: DealListParams): string {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") values.set(key, String(value));
  return values.size ? `?${values.toString()}` : "";
}

export function listDeals(token: string, params: DealListParams = {}): Promise<PaginatedResponse<DealDto>> {
  return apiRequest(`/api/deals${query(params)}`, token);
}
export function getDeal(token: string, id: string): Promise<DealDto> {
  return apiRequest(`/api/deals/${id}`, token);
}
export function createDeal(token: string, body: DealBody & { leadId: string }): Promise<DealDto> {
  return apiRequest("/api/deals", token, { method: "POST", body: JSON.stringify(body) });
}
export function updateDeal(token: string, id: string, body: DealBody): Promise<DealDto> {
  return apiRequest(`/api/deals/${id}`, token, { method: "PATCH", body: JSON.stringify(body) });
}
export function listPipelines(token: string): Promise<PipelineDto[]> {
  return apiRequest("/api/pipeline", token);
}
export function createPipeline(token: string, body: { name: string }): Promise<PipelineDto> {
  return apiRequest("/api/pipeline", token, { method: "POST", body: JSON.stringify(body) });
}
export function updatePipeline(token: string, id: string, body: { name?: string; status?: "ACTIVE" | "ARCHIVED" }): Promise<PipelineDto> {
  return apiRequest(`/api/pipeline/${id}`, token, { method: "PATCH", body: JSON.stringify(body) });
}
export function createPipelineStage(token: string, pipelineId: string, body: { name: string; probability: number; color?: string | null; isWon?: boolean; isLost?: boolean }): Promise<PipelineStageDto> {
  return apiRequest(`/api/pipeline/${pipelineId}/stages`, token, { method: "POST", body: JSON.stringify(body) });
}
export function updatePipelineStage(token: string, id: string, body: { name?: string; probability?: number; color?: string | null; status?: "ACTIVE" | "ARCHIVED" }): Promise<PipelineStageDto> {
  return apiRequest(`/api/pipeline/stages/${id}`, token, { method: "PATCH", body: JSON.stringify(body) });
}
export function reorderPipelineStages(token: string, pipelineId: string, stageIds: string[]): Promise<PipelineDto> {
  return apiRequest(`/api/pipeline/${pipelineId}/stages/order`, token, { method: "PUT", body: JSON.stringify({ stageIds }) });
}
