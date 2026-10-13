import type {
  AiCommandCenterDto,
  LeadAiControlStatusName,
  LeadDocumentDto,
  LeadDocumentKindName,
  LeadDocumentSourceTypeName,
  LeadFollowUpModeName,
  LeadIntelligenceDecisionDto,
  LeadIntelligenceDto,
  LeadPreferredChannelName
} from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export interface LeadIntelligenceControlsBody {
  aiControlStatus?: LeadAiControlStatusName;
  followUpMode?: LeadFollowUpModeName;
  humanInterventionRequired?: boolean;
  preferredChannel?: LeadPreferredChannelName;
  customCadenceDays?: number[];
}

export interface LeadDocumentBody {
  title: string;
  kind: LeadDocumentKindName;
  sourceType: LeadDocumentSourceTypeName;
  sourceUrl?: string;
  mimeType?: string;
  content?: string;
}

export function getLeadIntelligence(token: string, leadId: string): Promise<LeadIntelligenceDto> {
  return apiRequest(`/api/lead-intelligence/leads/${encodeURIComponent(leadId)}`, token);
}
export function refreshLeadIntelligence(
  token: string,
  leadId: string
): Promise<LeadIntelligenceDto> {
  return apiRequest(`/api/lead-intelligence/leads/${encodeURIComponent(leadId)}/refresh`, token, {
    method: "POST"
  });
}
export function updateLeadIntelligenceControls(
  token: string,
  leadId: string,
  body: LeadIntelligenceControlsBody
): Promise<LeadIntelligenceDto> {
  return apiRequest(`/api/lead-intelligence/leads/${encodeURIComponent(leadId)}/controls`, token, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}
export function decideLeadFollowUp(
  token: string,
  leadId: string
): Promise<LeadIntelligenceDecisionDto> {
  return apiRequest(`/api/lead-intelligence/leads/${encodeURIComponent(leadId)}/decisions`, token, {
    method: "POST"
  });
}
export function createLeadIntelligenceDocument(
  token: string,
  leadId: string,
  body: LeadDocumentBody
): Promise<LeadDocumentDto> {
  return apiRequest(`/api/lead-intelligence/leads/${encodeURIComponent(leadId)}/documents`, token, {
    method: "POST",
    body: JSON.stringify(body)
  });
}
export function deleteLeadIntelligenceDocument(
  token: string,
  leadId: string,
  documentId: string
): Promise<void> {
  return apiRequest(
    `/api/lead-intelligence/leads/${encodeURIComponent(leadId)}/documents/${encodeURIComponent(documentId)}`,
    token,
    { method: "DELETE" }
  );
}
export function getAiCommandCenter(token: string): Promise<AiCommandCenterDto> {
  return apiRequest("/api/lead-intelligence/command-center", token);
}
