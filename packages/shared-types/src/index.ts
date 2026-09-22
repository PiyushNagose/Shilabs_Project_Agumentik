export type ServiceName = "api" | "worker" | "web";

export interface HealthResponse {
  status: "ok";
  service: ServiceName;
  uptimeSeconds: number;
  timestamp: string;
}

export interface WorkerStatus {
  status: "ok" | "degraded";
  service: "worker";
  queuesEnabled: boolean;
  redisUrlConfigured: boolean;
  redisStatus: "CONFIGURED" | "NOT_CONFIGURED";
  domainEventQueueName: string;
}

export const USER_ROLES = ["ADMIN", "SALES_MANAGER", "SALES_REP"] as const;
export type UserRoleName = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type UserStatusName = (typeof USER_STATUSES)[number];

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRoleName;
  status: UserStatusName;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}

export interface CompanyDto {
  id: string;
  name: string;
  website: string | null;
  normalizedWebsite: string | null;
  industry: string | null;
  location: string | null;
  employeeRange: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactDto {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  normalizedEmail: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  whatsappId: string | null;
  source: string | null;
  preferredChannel: string | null;
  doNotContact: boolean;
  createdAt: string;
  updatedAt: string;
}

export const LEAD_STATUSES = ["OPEN", "WON", "LOST", "NURTURE", "DISQUALIFIED"] as const;
export type LeadStatusName = (typeof LEAD_STATUSES)[number];

export const LEAD_TEMPERATURES = ["HOT", "WARM", "NURTURE"] as const;
export type LeadTemperatureName = (typeof LEAD_TEMPERATURES)[number];

export interface PipelineStageDto {
  id: string;
  key: string;
  label: string;
  order: number;
  probability: number;
  isClosed: boolean;
  isWon: boolean;
  isLost: boolean;
}

export interface LeadDto {
  id: string;
  companyId: string;
  contactId: string;
  ownerId: string | null;
  source: string;
  status: LeadStatusName;
  stageId: string;
  requirement: string | null;
  serviceInterest: string | null;
  score: number;
  temperature: LeadTemperatureName;
  scoreOverrideAt: string | null;
  scoreOverrideByUserId: string | null;
  scoreOverrideReason: string | null;
  estimatedValue: string | null;
  currency: string;
  nextAction: string | null;
  nextActionAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  company: CompanyDto;
  contact: ContactDto;
  owner: PublicUser | null;
  stage: PipelineStageDto;
}

export interface PaginatedResponse<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const DEAL_STATUSES = ["OPEN", "WON", "LOST"] as const;
export type DealStatusName = (typeof DEAL_STATUSES)[number];

export const PROPOSAL_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED"] as const;
export type ProposalStatusName = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_WORKFLOW_STATUSES = [
  "DRAFT",
  "WAITING_APPROVAL",
  "APPROVED",
  "SENT"
] as const;
export type ProposalWorkflowStatusName = (typeof PROPOSAL_WORKFLOW_STATUSES)[number];

export const PROPOSAL_GENERATION_KINDS = ["GENERAL", "SEO", "WEB_DESIGN"] as const;
export type ProposalGenerationKindName = (typeof PROPOSAL_GENERATION_KINDS)[number];

export const PROPOSAL_GENERATION_STATUSES = ["COMPLETED", "NEEDS_INPUT", "FAILED"] as const;
export type ProposalGenerationStatusName = (typeof PROPOSAL_GENERATION_STATUSES)[number];

export const PROPOSAL_ZOHO_SYNC_STATUSES = [
  "NOT_REQUIRED",
  "PENDING",
  "SYNCED",
  "FAILED",
  "NOT_CONFIGURED"
] as const;
export type ProposalZohoSyncStatusName = (typeof PROPOSAL_ZOHO_SYNC_STATUSES)[number];

export const ACTIVITY_TYPES = [
  "LEAD_CREATED",
  "OWNER_CHANGED",
  "STAGE_CHANGED",
  "NOTE_ADDED",
  "DEAL_CREATED",
  "DEAL_UPDATED",
  "MESSAGE_RECEIVED",
  "MESSAGE_SENT",
  "QUALIFICATION_UPDATED",
  "SCORE_CHANGED",
  "PROPOSAL_CREATED",
  "PROPOSAL_GENERATED",
  "PROPOSAL_UPDATED",
  "PROPOSAL_SUBMITTED",
  "PROPOSAL_APPROVED",
  "PROPOSAL_SENT",
  "HUMAN_TAKEOVER",
  "NEGOTIATION_HANDOFF"
] as const;
export type ActivityTypeName = (typeof ACTIVITY_TYPES)[number];

export interface DealDto {
  id: string;
  leadId: string;
  stageId: string;
  ownerId: string | null;
  value: string | null;
  currency: string;
  probability: number;
  status: DealStatusName;
  proposalStatus: ProposalStatusName | null;
  wonReason: string | null;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
  lead: LeadDto;
  stage: PipelineStageDto;
  owner: PublicUser | null;
}

export interface ProposalVersionDto {
  id: string;
  proposalId: string;
  version: number;
  title: string;
  content: string;
  editSummary: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface ProposalStatusChangeDto {
  id: string;
  proposalId: string;
  fromStatus: ProposalWorkflowStatusName | null;
  toStatus: ProposalWorkflowStatusName;
  actorUserId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ProposalDto {
  id: string;
  leadId: string;
  dealId: string | null;
  title: string;
  serviceType: string | null;
  status: ProposalWorkflowStatusName;
  currentVersionId: string | null;
  approvedVersionId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  sentByUserId: string | null;
  sentAt: string | null;
  sentOutboundEmailId: string | null;
  zohoTimelineSyncStatus: ProposalZohoSyncStatusName;
  zohoTimelineLastError: string | null;
  idempotencyKey: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  lead: LeadDto;
  deal: DealDto | null;
  createdBy: PublicUser;
  approvedBy: PublicUser | null;
  sentBy: PublicUser | null;
  currentVersion: ProposalVersionDto | null;
  approvedVersion: ProposalVersionDto | null;
  versions: ProposalVersionDto[];
  statusChanges: ProposalStatusChangeDto[];
}

export interface ProposalGenerationRunDto {
  id: string;
  leadId: string;
  dealId: string | null;
  proposalId: string | null;
  actorUserId: string;
  kind: ProposalGenerationKindName;
  status: ProposalGenerationStatusName;
  provider: string | null;
  model: string | null;
  missingFields: string[];
  failureCode: string | null;
  failureMessage: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  proposal: ProposalDto | null;
}

export interface ProposalGenerationResultDto {
  run: ProposalGenerationRunDto;
  proposal: ProposalDto | null;
}

export interface ProposalSendResultDto {
  proposal: ProposalDto;
  outboundEmail: OutboundEmailDto;
  zohoTimeline: ZohoTimelineAppendDto | null;
}

export interface ActivityDto {
  id: string;
  leadId: string;
  actorUserId: string | null;
  type: ActivityTypeName;
  description: string;
  createdAt: string;
  actorUser: PublicUser | null;
}

export const CONVERSATION_CHANNELS = ["WEBSITE", "WHATSAPP", "EMAIL", "INTERNAL"] as const;
export type ConversationChannelName = (typeof CONVERSATION_CHANNELS)[number];

export const CONVERSATION_MODES = ["AUTO", "DRAFT_ONLY", "HUMAN", "PAUSED", "CLOSED"] as const;
export type ConversationModeName = (typeof CONVERSATION_MODES)[number];

export const CONVERSATION_STATUSES = ["OPEN", "CLOSED"] as const;
export type ConversationStatusName = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export type MessageDirectionName = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_SENDER_TYPES = ["PROSPECT", "USER", "AI", "SYSTEM"] as const;
export type MessageSenderTypeName = (typeof MESSAGE_SENDER_TYPES)[number];

export const MESSAGE_DELIVERY_STATUSES = [
  "PENDING",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED"
] as const;
export type MessageDeliveryStatusName = (typeof MESSAGE_DELIVERY_STATUSES)[number];

export interface ConversationDto {
  id: string;
  leadId: string;
  channel: ConversationChannelName;
  mode: ConversationModeName;
  status: ConversationStatusName;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  lead: LeadDto;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  providerMessageId: string | null;
  direction: MessageDirectionName;
  senderType: MessageSenderTypeName;
  senderUserId: string | null;
  body: string;
  deliveryStatus: MessageDeliveryStatusName;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  metadata: unknown;
  createdAt: string;
  senderUser: PublicUser | null;
}

export const HUMAN_TAKEOVER_STATUSES = ["ACTIVE"] as const;
export type HumanTakeoverStatusName = (typeof HUMAN_TAKEOVER_STATUSES)[number];

export interface HumanTakeoverDto {
  id: string;
  leadId: string;
  conversationId: string;
  takenOverByUserId: string;
  status: HumanTakeoverStatusName;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  takenOverBy: PublicUser;
}

export interface HumanTakeoverBriefingDto {
  takeover: HumanTakeoverDto;
  lead: LeadDto;
  requirements: {
    requirement: string | null;
    serviceInterest: string | null;
    nextAction: string | null;
    nextActionAt: string | null;
  };
  conversationSummary: {
    conversationId: string;
    mode: ConversationModeName;
    status: ConversationStatusName;
    lastMessageAt: string | null;
    messageCount: number;
    recentMessages: MessageDto[];
  };
  qualification: LeadQualificationDto;
  proposalContext: {
    proposals: ProposalDto[];
  };
  dealContext: {
    deal: DealDto | null;
  };
  latestActions: ActivityDto[];
}

export const NEGOTIATION_HANDOFF_STATUSES = ["ACTIVE", "ATTENTION_REQUIRED"] as const;
export type NegotiationHandoffStatusName = (typeof NEGOTIATION_HANDOFF_STATUSES)[number];

export const INTERNAL_NOTIFICATION_TYPES = ["NEGOTIATION_HANDOFF"] as const;
export type InternalNotificationTypeName = (typeof INTERNAL_NOTIFICATION_TYPES)[number];

export const INTERNAL_NOTIFICATION_STATUSES = ["UNREAD", "READ", "ATTENTION_REQUIRED"] as const;
export type InternalNotificationStatusName = (typeof INTERNAL_NOTIFICATION_STATUSES)[number];

export const INTERNAL_NOTIFICATION_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export type InternalNotificationSeverityName = (typeof INTERNAL_NOTIFICATION_SEVERITIES)[number];

export interface NegotiationHandoffDto {
  id: string;
  leadId: string;
  conversationId: string;
  replyProcessingRunId: string;
  assignedOwnerId: string | null;
  status: NegotiationHandoffStatusName;
  summary: string;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
  assignedOwner: PublicUser | null;
}

export interface InternalNotificationDto {
  id: string;
  type: InternalNotificationTypeName;
  status: InternalNotificationStatusName;
  severity: InternalNotificationSeverityName;
  title: string;
  body: string;
  assignedToUserId: string | null;
  leadId: string | null;
  conversationId: string | null;
  negotiationHandoffId: string | null;
  sourceEntityType: string;
  sourceEntityId: string;
  createdAt: string;
  updatedAt: string;
  negotiationHandoff: NegotiationHandoffDto | null;
}

export type SalesActionDashboardItemType =
  "PROPOSAL_APPROVAL" | "NEGOTIATION_HANDOFF" | "INTERNAL_ALERT" | "HUMAN_TAKEOVER" | "FAILURE";

export type SalesActionDashboardItemSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface SalesActionDashboardItemDto {
  id: string;
  type: SalesActionDashboardItemType;
  severity: SalesActionDashboardItemSeverity;
  title: string;
  detail: string;
  status: string;
  leadId: string | null;
  conversationId: string | null;
  proposalId: string | null;
  sourceEntityType: string;
  sourceEntityId: string;
  occurredAt: string;
  lead: LeadDto | null;
}

export interface SalesActionDashboardMeetingSectionDto {
  status: "AVAILABLE" | "NOT_AVAILABLE";
  items: SalesActionDashboardItemDto[];
  message: string;
}

export interface SalesActionDashboardDto {
  generatedAt: string;
  pendingProposalApprovals: SalesActionDashboardItemDto[];
  negotiationAndTakeoverAlerts: SalesActionDashboardItemDto[];
  failuresRequiringAttention: SalesActionDashboardItemDto[];
  meetings: SalesActionDashboardMeetingSectionDto;
  actionItems: SalesActionDashboardItemDto[];
  summary: {
    pendingProposalApprovals: number;
    negotiationAndTakeoverAlerts: number;
    failuresRequiringAttention: number;
    meetings: number;
    totalActionItems: number;
  };
}

export interface LeadQualificationEvidenceDto {
  id: string;
  qualificationId: string;
  messageId: string;
  quote: string;
  createdAt: string;
}

export interface LeadQualificationDto {
  id: string | null;
  leadId: string;
  need: string | null;
  requirement: string | null;
  budget: string | null;
  budgetBand: string | null;
  authority: string | null;
  timeline: string | null;
  businessFit: string | null;
  decisionMakerIdentified: boolean | null;
  urgency: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  evidence: LeadQualificationEvidenceDto[];
}

export const SCORING_FACTOR_KEYS = [
  "REQUIREMENT",
  "AUTHORITY",
  "BUDGET",
  "TIMELINE",
  "BUSINESS_FIT"
] as const;
export type ScoringFactorKeyName = (typeof SCORING_FACTOR_KEYS)[number];

export interface ScoringConfigDto {
  id: string;
  key: string;
  requirementWeight: number;
  authorityWeight: number;
  budgetWeight: number;
  timelineWeight: number;
  businessFitWeight: number;
  warmThreshold: number;
  hotThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeadScoreFactorDto {
  key: ScoringFactorKeyName;
  label: string;
  matched: boolean;
  weight: number;
  awarded: number;
  reason: string;
}

export interface LeadScoreResultDto {
  leadId: string;
  score: number;
  temperature: LeadTemperatureName;
  factors: LeadScoreFactorDto[];
  config: ScoringConfigDto;
  persisted: boolean;
  skippedReason: string | null;
  runId: string | null;
}

export interface LeadScoreOverrideDto {
  leadId: string;
  score: number;
  temperature: LeadTemperatureName;
  reason: string;
  overriddenAt: string;
  overriddenByUserId: string;
  runId: string;
}

export const INTEGRATION_PROVIDERS = ["ZOHO_BIGIN", "AWS_SES", "MAILPIT", "SEMRUSH"] as const;
export type IntegrationProviderName = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_ACCOUNT_STATUSES = [
  "NOT_CONFIGURED",
  "CONFIGURED",
  "ERROR",
  "DISABLED"
] as const;
export type IntegrationAccountStatusName = (typeof INTEGRATION_ACCOUNT_STATUSES)[number];

export interface IntegrationHealthDto {
  provider: IntegrationProviderName;
  status: IntegrationAccountStatusName;
  configured: boolean;
  checkedAt: string;
  accountId: string | null;
  apiDomain: string | null;
  accountsUrl: string | null;
  missingConfig: string[];
  scopes: string[];
  tokenExpiresAt: string | null;
  lastError: string | null;
}

export interface ZohoLeadContactSyncDto {
  provider: "ZOHO_BIGIN";
  status: "COMPLETED" | "PARTIAL" | "FAILED" | "SKIPPED" | "NOT_CONFIGURED";
  runId: string | null;
  startedAt: string;
  finishedAt: string;
  totalRecords: number;
  succeededRecords: number;
  failedRecords: number;
  skippedRecords: number;
  pagesFetched: number;
  lastError: string | null;
}

export interface ZohoDealSyncDto {
  provider: "ZOHO_BIGIN";
  status: "COMPLETED" | "PARTIAL" | "FAILED" | "SKIPPED" | "NOT_CONFIGURED";
  runId: string | null;
  startedAt: string;
  finishedAt: string;
  totalRecords: number;
  succeededRecords: number;
  failedRecords: number;
  skippedRecords: number;
  pagesFetched: number;
  lastError: string | null;
}

export interface ZohoTimelineAppendDto {
  provider: "ZOHO_BIGIN";
  status: "SYNCED" | "SKIPPED" | "FAILED" | "NOT_CONFIGURED";
  activityId: string;
  mappingId: string | null;
  externalRecordId: string | null;
  lastError: string | null;
}

export const OUTBOUND_EMAIL_STATUSES = [
  "PENDING",
  "BLOCKED",
  "SENT",
  "DELIVERED",
  "BOUNCED",
  "COMPLAINED",
  "FAILED"
] as const;
export type OutboundEmailStatusName = (typeof OUTBOUND_EMAIL_STATUSES)[number];

export interface OutboundEmailDto {
  id: string;
  leadId: string;
  contactId: string;
  actorUserId: string | null;
  toEmail: string;
  fromEmail: string;
  replyToEmail: string | null;
  subject: string;
  provider: IntegrationProviderName;
  providerMessageId: string | null;
  idempotencyKey: string;
  status: OutboundEmailStatusName;
  failureCode: string | null;
  failureMessage: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SesFeedbackEventDto {
  provider: "AWS_SES";
  status: "PROCESSED" | "DUPLICATE";
  eventId: string;
  outboundEmailId: string | null;
  type: "DELIVERY" | "BOUNCE" | "COMPLAINT";
}

export interface InboundEmailDto {
  id: string;
  provider: "AWS_SES";
  providerMessageId: string;
  providerEventId: string | null;
  leadId: string | null;
  contactId: string | null;
  conversationId: string | null;
  messageId: string | null;
  fromEmail: string;
  toEmails: string[];
  subject: string | null;
  textBody: string;
  status: "PROCESSED" | "FAILED";
  failureCode: string | null;
  failureMessage: string | null;
  replyProcessingStatus: "PENDING" | "PROCESSED" | "FAILED" | "SKIPPED" | null;
  receivedAt: string;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SesInboundEmailDto {
  provider: "AWS_SES";
  status: "PROCESSED" | "FAILED" | "DUPLICATE";
  inboundEmail: InboundEmailDto;
}

export const EMAIL_SUPPRESSION_REASONS = [
  "MANUAL",
  "INVALID",
  "BOUNCE",
  "COMPLAINT",
  "UNSUBSCRIBE",
  "PROVIDER"
] as const;
export type EmailSuppressionReasonName = (typeof EMAIL_SUPPRESSION_REASONS)[number];

export interface EmailSuppressionDto {
  id: string;
  email: string;
  normalizedEmail: string;
  reason: EmailSuppressionReasonName;
  source: string;
  provider: IntegrationProviderName | null;
  providerEventId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailPreSendValidationDto {
  allowed: boolean;
  leadId: string;
  contactId: string | null;
  normalizedEmail: string | null;
  code: string | null;
  message: string | null;
  suppression: EmailSuppressionDto | null;
}

export interface EmailDeliverabilityScanDto {
  id: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  requestedByUserId: string | null;
  startedAt: string;
  finishedAt: string | null;
  totalContacts: number;
  eligibleContacts: number;
  suppressedContacts: number;
  invalidContacts: number;
  doNotContactContacts: number;
  terminalLeadContacts: number;
  createdSuppressions: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export const KNOWLEDGE_BASE_CATEGORIES = [
  "COMPANY",
  "SERVICE",
  "PROPOSAL",
  "SEO",
  "WEB_DESIGN",
  "GENERAL"
] as const;
export type KnowledgeBaseCategoryName = (typeof KNOWLEDGE_BASE_CATEGORIES)[number];

export const KNOWLEDGE_BASE_STATUSES = ["DRAFT", "APPROVED", "INACTIVE"] as const;
export type KnowledgeBaseStatusName = (typeof KNOWLEDGE_BASE_STATUSES)[number];

export interface KnowledgeBaseVersionDto {
  id: string;
  entryId: string;
  version: number;
  content: string;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceType: string;
  correctionOfVersionId: string | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface KnowledgeBaseEntryDto {
  id: string;
  key: string;
  title: string;
  category: KnowledgeBaseCategoryName;
  status: KnowledgeBaseStatusName;
  activeVersionId: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  activeVersion: KnowledgeBaseVersionDto | null;
  versions: KnowledgeBaseVersionDto[];
}

export interface ApprovedKnowledgeDto {
  entryId: string;
  key: string;
  title: string;
  category: KnowledgeBaseCategoryName;
  versionId: string;
  version: number;
  content: string;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceType: string;
  approvedByUserId: string | null;
  approvedAt: string;
}

export const REPLY_INTENTS = [
  "INTERESTED",
  "NOT_INTERESTED",
  "PROPOSAL_REQUEST",
  "MEETING_REQUEST",
  "NEGOTIATION",
  "QUESTION",
  "UNCLEAR"
] as const;
export type ReplyIntentName = (typeof REPLY_INTENTS)[number];

export const REPLY_RECOMMENDED_ACTIONS = [
  "DRAFT_RESPONSE",
  "STOP_AUTOMATION",
  "HUMAN_HANDOFF",
  "PROPOSAL_REVIEW",
  "MEETING_REVIEW",
  "NO_ACTION"
] as const;
export type ReplyRecommendedActionName = (typeof REPLY_RECOMMENDED_ACTIONS)[number];

export interface ReplyProcessingRunDto {
  id: string;
  leadId: string;
  conversationId: string;
  messageId: string;
  inboundEmailId: string | null;
  status: "COMPLETED" | "FAILED" | "SKIPPED";
  intent: ReplyIntentName | null;
  recommendedAction: ReplyRecommendedActionName | null;
  confidence: string | null;
  summary: string | null;
  draftResponse: string | null;
  requiresHumanReview: boolean;
  humanHandoffRequired: boolean;
  provider: string | null;
  model: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export const DOMAIN_EVENT_STATUSES = [
  "PENDING",
  "QUEUED",
  "PROCESSING",
  "PROCESSED",
  "FAILED",
  "ATTENTION_REQUIRED"
] as const;
export type DomainEventStatusName = (typeof DOMAIN_EVENT_STATUSES)[number];

export const DOMAIN_EVENT_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type DomainEventPriorityName = (typeof DOMAIN_EVENT_PRIORITIES)[number];

export interface DomainEventOutboxDto {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: DomainEventStatusName;
  priority: DomainEventPriorityName;
  correlationId: string;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  queueName: string | null;
  queueJobId: string | null;
  queuedAt: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  processedAt: string | null;
  failedAt: string | null;
  deadLetteredAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  retryRequestedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const FOLLOW_UP_SEQUENCE_STATUSES = [
  "ACTIVE",
  "STOPPED",
  "COMPLETED",
  "ATTENTION_REQUIRED"
] as const;
export type FollowUpSequenceStatusName = (typeof FOLLOW_UP_SEQUENCE_STATUSES)[number];

export const FOLLOW_UP_ATTEMPT_STATUSES = [
  "SCHEDULED",
  "SENDING",
  "SENT",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
  "SKIPPED"
] as const;
export type FollowUpAttemptStatusName = (typeof FOLLOW_UP_ATTEMPT_STATUSES)[number];

export const FOLLOW_UP_ATTEMPT_KINDS = ["FIRST_EMAIL", "FOLLOW_UP"] as const;
export type FollowUpAttemptKindName = (typeof FOLLOW_UP_ATTEMPT_KINDS)[number];

export const FOLLOW_UP_ZOHO_SYNC_STATUSES = [
  "NOT_REQUIRED",
  "PENDING",
  "SYNCED",
  "FAILED"
] as const;
export type FollowUpZohoSyncStatusName = (typeof FOLLOW_UP_ZOHO_SYNC_STATUSES)[number];

export interface FollowUpAttemptDto {
  id: string;
  sequenceId: string;
  leadId: string;
  stepIndex: number;
  kind: FollowUpAttemptKindName;
  status: FollowUpAttemptStatusName;
  scheduledAt: string;
  subject: string;
  idempotencyKey: string;
  domainEventId: string | null;
  outboundEmailId: string | null;
  zohoSyncStatus: FollowUpZohoSyncStatusName;
  zohoLastError: string | null;
  sentAt: string | null;
  failedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpSequenceDto {
  id: string;
  leadId: string;
  contactId: string;
  conversationId: string | null;
  status: FollowUpSequenceStatusName;
  cadenceDays: number[];
  currentStep: number;
  stopReason: string | null;
  stoppedAt: string | null;
  completedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  idempotencyKey: string;
  attempts: FollowUpAttemptDto[];
  createdAt: string;
  updatedAt: string;
}
