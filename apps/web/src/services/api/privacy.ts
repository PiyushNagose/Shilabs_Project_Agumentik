import { apiRequest } from "./core.js";

export const privacyCategories = ["email", "messages", "calls", "providerPayloads", "ai", "files", "audit", "deletedRecords"] as const;
export type PrivacyCategory = (typeof privacyCategories)[number];
export interface PrivacyPolicy {
  enabled: boolean;
  revision: number;
  periods: Partial<Record<PrivacyCategory, number | null>>;
}
export interface CleanupPreview {
  previewId: string;
  expiresAt: string;
  counts: Record<PrivacyCategory, number>;
  hasMore: boolean;
}
export const getPrivacyPolicy = (token: string): Promise<PrivacyPolicy> => apiRequest("/api/privacy/policy", token);
export const savePrivacyPolicy = (token: string, body: PrivacyPolicy): Promise<PrivacyPolicy> => apiRequest("/api/privacy/policy", token, { method: "PUT", body: JSON.stringify(body) });
export const previewPrivacyCleanup = (token: string): Promise<CleanupPreview> => apiRequest("/api/privacy/cleanup/preview", token, { method: "POST" });
export const applyPrivacyCleanup = (token: string, previewId: string): Promise<{ cleaned: number }> => apiRequest("/api/privacy/cleanup/apply", token, { method: "POST", body: JSON.stringify({ previewId, confirmation: "APPLY CLEANUP" }) });
export const exportContactData = (token: string, contactId: string): Promise<unknown> => apiRequest(`/api/privacy/contacts/${encodeURIComponent(contactId)}/export`, token);
export const eraseContactData = (token: string, contactId: string): Promise<{ anonymized: boolean; externalCopies: string }> => apiRequest(`/api/privacy/contacts/${encodeURIComponent(contactId)}/erase`, token, { method: "POST", body: JSON.stringify({ confirmation: "ERASE CONTACT" }) });
