import type {
  ActivityDto,
  ConversationChannelName,
  ConversationDto,
  ConversationModeName,
  HumanTakeoverBriefingDto,
  HumanTakeoverDto,
  InternalNotificationDto,
  LeadDto,
  MessageDirectionName,
  MessageDto,
  MessageSenderTypeName,
  PaginatedResponse,
  PipelineStageDto,
  ProposalDto,
  ProposalSendResultDto,
  ProposalWorkflowStatusName,
  PublicUser,
  SalesActionDashboardDto
} from "@shilabs/shared-types";

const viteEnv = import.meta.env as Readonly<Record<string, string | undefined>>;
export const apiBaseUrl = viteEnv.VITE_API_BASE_URL ?? "http://localhost:4000";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function apiRequest<TResponse>(
  path: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<TResponse> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    throw new ApiClientError("Request failed", response.status);
  }

  return (await response.json()) as TResponse;
}

export interface LeadListParams {
  search?: string;
  status?: string;
  stageId?: string;
  ownerId?: string;
  temperature?: string;
  page?: number;
  pageSize?: number;
  sort?: "createdAt" | "lastActivityAt";
  direction?: "asc" | "desc";
}

export interface ConversationListParams {
  leadId?: string;
  channel?: ConversationChannelName;
  mode?: ConversationModeName;
  status?: string;
}

export interface ProposalListParams {
  leadId?: string;
  dealId?: string;
  status?: ProposalWorkflowStatusName;
  limit?: number;
}

export interface CreateConversationBody {
  leadId: string;
  channel: ConversationChannelName;
  mode?: ConversationModeName;
}

export interface CreateMessageBody {
  direction: MessageDirectionName;
  senderType: MessageSenderTypeName;
  body: string;
}

export interface UpdateProposalDraftBody {
  title?: string;
  serviceType?: string | null;
  content: string;
  editSummary?: string;
}

export interface ProposalActionBody {
  reason?: string;
}

export interface SendApprovedProposalBody {
  subject?: string;
  idempotencyKey?: string;
}

export interface StartHumanTakeoverBody {
  reason?: string;
}

export interface NotificationListParams {
  leadId?: string;
  status?: string;
  limit?: number;
}

function toQueryString(
  params: LeadListParams | ConversationListParams | ProposalListParams | NotificationListParams
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export function listLeads(
  accessToken: string,
  params: LeadListParams
): Promise<PaginatedResponse<LeadDto>> {
  return apiRequest<PaginatedResponse<LeadDto>>(`/api/leads${toQueryString(params)}`, accessToken);
}

export function getLead(accessToken: string, leadId: string): Promise<LeadDto> {
  return apiRequest<LeadDto>(`/api/leads/${leadId}`, accessToken);
}

export function listUsers(accessToken: string): Promise<PublicUser[]> {
  return apiRequest<PublicUser[]>("/api/users", accessToken);
}

export function listPipelineStages(accessToken: string): Promise<PipelineStageDto[]> {
  return apiRequest<PipelineStageDto[]>("/api/pipeline/stages", accessToken);
}

export function getSalesActionDashboard(accessToken: string): Promise<SalesActionDashboardDto> {
  return apiRequest<SalesActionDashboardDto>("/api/action-dashboard", accessToken);
}

export function updateLeadStage(
  accessToken: string,
  leadId: string,
  stageId: string
): Promise<LeadDto> {
  return apiRequest<LeadDto>(`/api/leads/${leadId}/stage`, accessToken, {
    method: "PATCH",
    body: JSON.stringify({ stageId })
  });
}

export function assignLead(
  accessToken: string,
  leadId: string,
  ownerId: string | null
): Promise<LeadDto> {
  return apiRequest<LeadDto>(`/api/leads/${leadId}/assign`, accessToken, {
    method: "PATCH",
    body: JSON.stringify({ ownerId })
  });
}

export function listLeadActivities(accessToken: string, leadId: string): Promise<ActivityDto[]> {
  return apiRequest<ActivityDto[]>(`/api/leads/${leadId}/activities`, accessToken);
}

export function listNotifications(
  accessToken: string,
  params: NotificationListParams
): Promise<InternalNotificationDto[]> {
  return apiRequest<InternalNotificationDto[]>(
    `/api/notifications${toQueryString(params)}`,
    accessToken
  );
}

export function listConversations(
  accessToken: string,
  params: ConversationListParams
): Promise<ConversationDto[]> {
  return apiRequest<ConversationDto[]>(`/api/conversations${toQueryString(params)}`, accessToken);
}

export function createConversation(
  accessToken: string,
  body: CreateConversationBody
): Promise<ConversationDto> {
  return apiRequest<ConversationDto>("/api/conversations", accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function listConversationMessages(
  accessToken: string,
  conversationId: string
): Promise<MessageDto[]> {
  return apiRequest<MessageDto[]>(`/api/conversations/${conversationId}/messages`, accessToken);
}

export function appendConversationMessage(
  accessToken: string,
  conversationId: string,
  body: CreateMessageBody
): Promise<MessageDto> {
  return apiRequest<MessageDto>(`/api/conversations/${conversationId}/messages`, accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function updateConversationMode(
  accessToken: string,
  conversationId: string,
  mode: ConversationModeName
): Promise<ConversationDto> {
  return apiRequest<ConversationDto>(`/api/conversations/${conversationId}/mode`, accessToken, {
    method: "PATCH",
    body: JSON.stringify({ mode })
  });
}

export function startHumanTakeover(
  accessToken: string,
  conversationId: string,
  body: StartHumanTakeoverBody = {}
): Promise<HumanTakeoverDto> {
  return apiRequest<HumanTakeoverDto>(
    `/api/conversations/${conversationId}/takeover`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
}

export function getHumanTakeoverBriefing(
  accessToken: string,
  conversationId: string
): Promise<HumanTakeoverBriefingDto> {
  return apiRequest<HumanTakeoverBriefingDto>(
    `/api/conversations/${conversationId}/takeover/briefing`,
    accessToken
  );
}

export function listProposals(
  accessToken: string,
  params: ProposalListParams
): Promise<ProposalDto[]> {
  return apiRequest<ProposalDto[]>(`/api/proposals${toQueryString(params)}`, accessToken);
}

export function updateProposalDraft(
  accessToken: string,
  proposalId: string,
  body: UpdateProposalDraftBody
): Promise<ProposalDto> {
  return apiRequest<ProposalDto>(`/api/proposals/${proposalId}/draft`, accessToken, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function approveProposal(
  accessToken: string,
  proposalId: string,
  body: ProposalActionBody = {}
): Promise<ProposalDto> {
  return apiRequest<ProposalDto>(`/api/proposals/${proposalId}/approve`, accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function sendApprovedProposal(
  accessToken: string,
  proposalId: string,
  body: SendApprovedProposalBody = {}
): Promise<ProposalSendResultDto> {
  return apiRequest<ProposalSendResultDto>(`/api/proposals/${proposalId}/send`, accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
}
