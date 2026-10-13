import type {
  WorkflowDashboardDto,
  WorkflowDefinitionDto,
  WorkflowDetailDto,
  WorkflowPolicyDto,
  WorkflowPreviewDto,
  WorkflowStatusName,
  WorkflowValidationDto
} from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export function listWorkflows(token: string): Promise<WorkflowDashboardDto> {
  return apiRequest("/api/workflows", token);
}
export function getWorkflow(token: string, id: string): Promise<WorkflowDetailDto> {
  return apiRequest(`/api/workflows/${id}`, token);
}
export function createWorkflow(
  token: string,
  body: { name: string; description: string }
): Promise<WorkflowDetailDto> {
  return apiRequest("/api/workflows", token, { method: "POST", body: JSON.stringify(body) });
}
export function updateWorkflowStatus(
  token: string,
  id: string,
  status: Exclude<WorkflowStatusName, "DRAFT">
): Promise<WorkflowDetailDto> {
  return apiRequest(`/api/workflows/${id}/status`, token, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}
export function saveWorkflowDraft(
  token: string,
  id: string,
  definition: WorkflowDefinitionDto,
  policyConfig?: WorkflowPolicyDto
): Promise<WorkflowDetailDto> {
  return apiRequest(`/api/workflows/${id}/draft`, token, {
    method: "PUT",
    body: JSON.stringify({ definition, policyConfig })
  });
}
export function validateWorkflow(token: string, id: string): Promise<WorkflowValidationDto> {
  return apiRequest(`/api/workflows/${id}/validate`, token, { method: "POST" });
}
export function previewWorkflow(
  token: string,
  id: string,
  definition: WorkflowDefinitionDto
): Promise<WorkflowPreviewDto> {
  return apiRequest(`/api/workflows/${id}/preview`, token, {
    method: "POST",
    body: JSON.stringify({ definition })
  });
}
export function publishWorkflow(token: string, id: string): Promise<WorkflowDetailDto> {
  return apiRequest(`/api/workflows/${id}/publish`, token, { method: "POST" });
}
