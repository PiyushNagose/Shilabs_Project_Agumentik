import type { IntegrationConnectionDto, IntegrationDashboardDto } from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export function listIntegrations(token: string): Promise<IntegrationDashboardDto> {
  return apiRequest("/api/integrations", token);
}
export function connectIntegration(token: string, key: string): Promise<IntegrationConnectionDto> {
  return apiRequest(`/api/integrations/catalog/${encodeURIComponent(key)}/connect`, token, {
    method: "POST",
    body: "{}"
  });
}
export function reconnectIntegration(token: string, id: string): Promise<IntegrationConnectionDto> {
  return apiRequest(`/api/integrations/connections/${encodeURIComponent(id)}/reconnect`, token, {
    method: "POST"
  });
}
export function disableIntegration(token: string, id: string): Promise<IntegrationConnectionDto> {
  return apiRequest(`/api/integrations/connections/${encodeURIComponent(id)}/disable`, token, {
    method: "POST"
  });
}
export function disconnectIntegration(token: string, id: string): Promise<void> {
  return apiRequest(`/api/integrations/connections/${encodeURIComponent(id)}`, token, {
    method: "DELETE"
  });
}
