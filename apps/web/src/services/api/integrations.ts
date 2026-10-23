import type { IntegrationConnectionDto, IntegrationDashboardDto } from "@shilabs/shared-types";
import { apiBaseUrl, apiRequest } from "./core.js";

export function getCalendarOAuthStatus(token: string): Promise<{ enabled: boolean }> {
  return apiRequest("/api/calendar/oauth/google/status", token);
}

export function startCalendarOAuth(token: string, calendarId = "primary"): Promise<{ authorizationUrl: string; launchToken: string }> {
  return apiRequest("/api/calendar/oauth/google/start", token, { method: "POST", credentials: "include", body: JSON.stringify({ calendarId }) });
}

export function navigateToCalendarAuthorization(launchToken: string): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${apiBaseUrl}/api/calendar/oauth/google/authorize`;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "launchToken";
  input.value = launchToken;
  form.append(input);
  document.body.append(form);
  form.submit();
  form.remove();
}

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
