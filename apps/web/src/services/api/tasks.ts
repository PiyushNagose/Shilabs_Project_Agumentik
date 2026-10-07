import type { TaskDto, TaskStatusName } from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export interface TaskListParams {
  leadId?: string;
  status?: TaskStatusName;
}

function taskQuery(params: TaskListParams): string {
  const search = new URLSearchParams();
  if (params.leadId) search.set("leadId", params.leadId);
  if (params.status) search.set("status", params.status);
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function listTasks(accessToken: string, params: TaskListParams): Promise<TaskDto[]> {
  return apiRequest<TaskDto[]>(`/api/tasks${taskQuery(params)}`, accessToken);
}

export function completeTask(accessToken: string, taskId: string): Promise<TaskDto> {
  return apiRequest<TaskDto>(`/api/tasks/${taskId}/complete`, accessToken, {
    method: "POST"
  });
}
