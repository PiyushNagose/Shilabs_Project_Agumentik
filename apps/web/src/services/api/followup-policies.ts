import type { FollowUpPolicyDto } from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export interface FollowUpPolicyBody {
  name: string;
  enabled: boolean;
  isDefault: boolean;
  selectionPriority: number;
  companyId?: string | null;
  communicationPersonality?: string | null;
  service?: string | null;
  leadType?: string | null;
  source?: string | null;
  country?: string | null;
  priority?: string | null;
  managerId?: string | null;
  campaign?: string | null;
  pipelineStageId?: string | null;
  cadenceDays: number[];
}

export function listFollowUpPolicies(accessToken: string): Promise<FollowUpPolicyDto[]> {
  return apiRequest("/api/followups/policies", accessToken);
}

export function createFollowUpPolicy(
  accessToken: string,
  body: FollowUpPolicyBody
): Promise<FollowUpPolicyDto> {
  return apiRequest("/api/followups/policies", accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function updateFollowUpPolicy(
  accessToken: string,
  policyId: string,
  body: Partial<FollowUpPolicyBody>
): Promise<FollowUpPolicyDto> {
  return apiRequest(`/api/followups/policies/${policyId}`, accessToken, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function deleteFollowUpPolicy(accessToken: string, policyId: string): Promise<void> {
  return apiRequest(`/api/followups/policies/${policyId}`, accessToken, { method: "DELETE" });
}
