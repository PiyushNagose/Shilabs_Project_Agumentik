import type {
  ActivityDto,
  AgentCorrectionDto,
  BriefingRunDto,
  ConversationChannelName,
  ConversationDto,
  ConversationModeName,
  HumanTakeoverBriefingDto,
  HumanTakeoverDto,
  HumanConversationReplyDto,
  FollowUpSequenceDto,
  InternalNotificationDto,
  LeadQualificationDto,
  LeadDto,
  MeetingRequestDto,
  OperationsDashboardDto,
  MessageDirectionName,
  MessageDto,
  MessageSenderTypeName,
  PaginatedResponse,
  PipelineStageDto,
  ProposalDto,
  ProposalGenerationKindName,
  ProposalGenerationResultDto,
  ProposalSendResultDto,
  ProposalWorkflowStatusName,
  PublicUser,
  ReplyProcessingRunDto,
  SalesActionDashboardDto,
  SesInboundEmailDto,
  ZohoLeadContactSyncDto
} from "@shilabs/shared-types";

const viteEnv = import.meta.env as Readonly<Record<string, string | undefined>>;
export const apiBaseUrl = viteEnv.VITE_API_BASE_URL ?? "http://localhost:4000";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

function isErrorPayload(value: unknown): value is { message?: unknown; code?: unknown } {
  return typeof value === "object" && value !== null;
}

function notifyAuthInvalid(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("shilabs:auth-invalid"));
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
    if (response.status === 401) {
      notifyAuthInvalid();
    }
    let message = "Request failed";
    let code: string | undefined;
    try {
      const payload: unknown = await response.json();
      if (isErrorPayload(payload)) {
        if (typeof payload.message === "string" && payload.message.trim().length > 0) {
          message = payload.message;
        }
        if (typeof payload.code === "string" && payload.code.trim().length > 0) {
          code = payload.code;
        }
      }
    } catch {
      // Keep the generic safe message when the response body is not JSON.
    }
    throw new ApiClientError(message, response.status, code);
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

export interface AgentCorrectionListParams {
  sourceEntityType?: string;
  sourceEntityId?: string;
  leadId?: string;
  proposalId?: string;
  limit?: number;
}

export interface CreateProposalCorrectionBody {
  correctedOutcome: unknown;
  correctionSummary: string;
  supersedesCorrectionId?: string;
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

export interface GenerateProposalBody {
  leadId: string;
  dealId?: string;
  kind: ProposalGenerationKindName;
  targetWebsite?: string;
  additionalContext?: string;
  idempotencyKey?: string;
}

export interface StartHumanTakeoverBody {
  reason?: string;
}

export interface StartFollowUpSequenceBody {
  idempotencyKey?: string;
}

export interface NotificationListParams {
  leadId?: string;
  status?: string;
  limit?: number;
}

export interface MeetingListParams {
  leadId?: string;
  status?: string;
  limit?: number;
}

export interface BriefingListParams {
  leadId?: string;
  meetingRequestId?: string;
  kind?: string;
  status?: string;
  limit?: number;
}

export interface CreateMeetingRequestBody {
  leadId: string;
  conversationId?: string;
  ownerId?: string;
  title: string;
  description?: string;
  timeZone: string;
  windowStart: string;
  windowEnd: string;
  durationMinutes: number;
  slotMinutes?: number;
  idempotencyKey?: string;
}

export interface ConfirmMeetingRequestBody {
  slotId: string;
  idempotencyKey?: string;
}

function toQueryString(
  params:
    | LeadListParams
    | ConversationListParams
    | ProposalListParams
    | NotificationListParams
    | MeetingListParams
    | BriefingListParams
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

export function getLeadQualification(
  accessToken: string,
  leadId: string
): Promise<LeadQualificationDto> {
  return apiRequest<LeadQualificationDto>(`/api/leads/${leadId}/qualification`, accessToken);
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

export function getOperationsDashboard(accessToken: string): Promise<OperationsDashboardDto> {
  return apiRequest<OperationsDashboardDto>("/api/operations/dashboard", accessToken);
}

export function syncZohoLeadContacts(accessToken: string): Promise<ZohoLeadContactSyncDto> {
  return apiRequest<ZohoLeadContactSyncDto>(
    "/api/integrations/zoho-bigin/sync/leads-contacts",
    accessToken,
    { method: "POST" }
  );
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

export function markNotificationRead(
  accessToken: string,
  notificationId: string
): Promise<InternalNotificationDto> {
  return apiRequest<InternalNotificationDto>(`/api/notifications/${notificationId}/read`, accessToken, {
    method: "PATCH",
    body: JSON.stringify({})
  });
}

export function acknowledgeNotification(
  accessToken: string,
  notificationId: string,
  body: { note?: string } = {}
): Promise<InternalNotificationDto> {
  return apiRequest<InternalNotificationDto>(
    `/api/notifications/${notificationId}/acknowledge`,
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify(body)
    }
  );
}

export function retryDomainEvent(accessToken: string, eventId: string): Promise<unknown> {
  return apiRequest<unknown>(`/api/domain-events/${eventId}/retry`, accessToken, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function listMeetingRequests(
  accessToken: string,
  params: MeetingListParams
): Promise<MeetingRequestDto[]> {
  return apiRequest<MeetingRequestDto[]>(
    `/api/meetings/requests${toQueryString(params)}`,
    accessToken
  );
}

export function createMeetingRequest(
  accessToken: string,
  body: CreateMeetingRequestBody
): Promise<MeetingRequestDto> {
  return apiRequest<MeetingRequestDto>("/api/meetings/requests", accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function confirmMeetingRequest(
  accessToken: string,
  meetingRequestId: string,
  body: ConfirmMeetingRequestBody
): Promise<MeetingRequestDto> {
  return apiRequest<MeetingRequestDto>(
    `/api/meetings/requests/${meetingRequestId}/confirm`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
}

export function listBriefings(
  accessToken: string,
  params: BriefingListParams
): Promise<BriefingRunDto[]> {
  return apiRequest<BriefingRunDto[]>(`/api/briefings${toQueryString(params)}`, accessToken);
}

export function generateLeadBriefing(
  accessToken: string,
  leadId: string,
  body: { idempotencyKey?: string } = {}
): Promise<BriefingRunDto> {
  return apiRequest<BriefingRunDto>(`/api/briefings/leads/${leadId}/generate`, accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function generateMeetingBriefing(
  accessToken: string,
  meetingRequestId: string,
  body: { idempotencyKey?: string } = {}
): Promise<BriefingRunDto> {
  return apiRequest<BriefingRunDto>(
    `/api/briefings/meetings/${meetingRequestId}/generate`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
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

export function listFollowUpSequences(
  accessToken: string,
  leadId: string
): Promise<FollowUpSequenceDto[]> {
  return apiRequest<FollowUpSequenceDto[]>(`/api/followups/leads/${leadId}`, accessToken);
}

export function startFollowUpSequence(
  accessToken: string,
  leadId: string,
  body: StartFollowUpSequenceBody = {}
): Promise<FollowUpSequenceDto> {
  return apiRequest<FollowUpSequenceDto>(`/api/followups/leads/${leadId}/start`, accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function accelerateFollowUpSequenceForE2E(
  accessToken: string,
  sequenceId: string
): Promise<FollowUpSequenceDto> {
  return apiRequest<FollowUpSequenceDto>(
    `/api/followups/sequences/${sequenceId}/e2e/accelerate`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function runCallingAttemptNowForE2E(
  accessToken: string,
  leadId: string
): Promise<{ status: "ACCELERATED" | "ALREADY_QUEUED"; attemptId: string; scheduledAt: string }> {
  return apiRequest(`/api/followups/leads/${leadId}/calling/e2e/run-now`, accessToken, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function submitE2ECustomerReply(
  accessToken: string,
  body: { leadId: string; subject?: string; body: string }
): Promise<SesInboundEmailDto> {
  return apiRequest<SesInboundEmailDto>("/api/email/e2e/customer-reply", accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function processInboundReply(
  accessToken: string,
  inboundEmailId: string
): Promise<ReplyProcessingRunDto> {
  return apiRequest<ReplyProcessingRunDto>(
    `/api/reply-processing/inbound-emails/${inboundEmailId}/process`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
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

export function sendHumanConversationReply(
  accessToken: string,
  conversationId: string,
  body: { subject?: string; body: string; idempotencyKey: string }
): Promise<HumanConversationReplyDto> {
  return apiRequest<HumanConversationReplyDto>(
    `/api/conversations/${conversationId}/human-reply`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
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

export function generateProposal(
  accessToken: string,
  body: GenerateProposalBody
): Promise<ProposalGenerationResultDto> {
  return apiRequest<ProposalGenerationResultDto>("/api/proposals/generate", accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
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

export function listAgentCorrections(
  accessToken: string,
  params: AgentCorrectionListParams
): Promise<AgentCorrectionDto[]> {
  return apiRequest<AgentCorrectionDto[]>(
    `/api/agent-feedback/corrections${toQueryString(params)}`,
    accessToken
  );
}

export function createProposalAgentCorrection(
  accessToken: string,
  proposalId: string,
  body: CreateProposalCorrectionBody
): Promise<AgentCorrectionDto> {
  return apiRequest<AgentCorrectionDto>(
    `/api/agent-feedback/proposals/${proposalId}/corrections`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
}
