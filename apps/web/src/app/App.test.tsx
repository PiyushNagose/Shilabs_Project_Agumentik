/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { ProposalDto } from "@shilabs/shared-types";
import { App } from "./App.js";

const adminUser = {
  id: "user_1",
  email: "admin@example.local",
  firstName: "Development",
  lastName: "Admin",
  role: "ADMIN",
  status: "ACTIVE",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const repUser = {
  id: "user_2",
  email: "rep@example.local",
  firstName: "Sales",
  lastName: "Rep",
  role: "SALES_REP",
  status: "ACTIVE",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const newStage = {
  id: "stage_new",
  key: "NEW",
  label: "New",
  order: 10,
  probability: 5,
  isClosed: false,
  isWon: false,
  isLost: false
};

const qualifiedStage = {
  id: "stage_qualified",
  key: "QUALIFIED",
  label: "Qualified",
  order: 40,
  probability: 50,
  isClosed: false,
  isWon: false,
  isLost: false
};

const lead = {
  id: "lead_1",
  companyId: "company_1",
  contactId: "contact_1",
  ownerId: adminUser.id,
  source: "website",
  status: "OPEN",
  stageId: newStage.id,
  requirement: "Needs a production CRM workspace",
  serviceInterest: "CRM",
  score: 72,
  temperature: "WARM",
  estimatedValue: "12000",
  currency: "USD",
  nextAction: "Schedule discovery",
  nextActionAt: null,
  lastActivityAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  company: {
    id: "company_1",
    name: "Shilabs Prospect",
    website: "https://example.com",
    normalizedWebsite: "example.com",
    industry: "Technology",
    location: "India",
    employeeRange: "11-50",
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  contact: {
    id: "contact_1",
    companyId: "company_1",
    firstName: "Priya",
    lastName: "Prospect",
    title: "Founder",
    email: "priya@example.com",
    normalizedEmail: "priya@example.com",
    phone: null,
    normalizedPhone: null,
    whatsappId: null,
    source: "website",
    preferredChannel: null,
    doNotContact: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  owner: adminUser,
  stage: newStage
};

const conversation = {
  id: "conversation_1",
  leadId: lead.id,
  channel: "WEBSITE",
  mode: "AUTO",
  status: "OPEN",
  lastMessageAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lead
};

const inboundMessage = {
  id: "message_1",
  conversationId: conversation.id,
  providerMessageId: null,
  direction: "INBOUND",
  senderType: "PROSPECT",
  senderUserId: null,
  body: "We need a new real-estate website.",
  deliveryStatus: "PENDING",
  sentAt: null,
  deliveredAt: null,
  readAt: null,
  failedAt: null,
  metadata: null,
  createdAt: new Date().toISOString(),
  senderUser: null
};

const leadQualification = {
  id: "qualification_1",
  leadId: lead.id,
  need: "AI sales automation for website leads",
  requirement: "Automated lead follow-up and qualification",
  budget: "INR 100000 per month",
  budgetBand: null,
  authority: "Founder is the final decision maker",
  timeline: "Launch within 30 days",
  businessFit: "Strong fit for automated follow-up",
  decisionMakerIdentified: true,
  urgency: "High",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  evidence: [
    {
      id: "qualification_evidence_1",
      qualificationId: "qualification_1",
      messageId: inboundMessage.id,
      quote:
        "We need AI sales automation for website leads. I am the founder and final decision maker.",
      createdAt: new Date().toISOString()
    }
  ]
};

const humanConversation = {
  ...conversation,
  mode: "HUMAN"
};

const followUpSequence = {
  id: "sequence_1",
  leadId: lead.id,
  contactId: lead.contactId,
  conversationId: conversation.id,
  status: "ACTIVE",
  cadenceDays: [0, 1, 5, 9],
  cadenceMode: "PRODUCTION_DAYS",
  cadenceOffsetsMinutes: [0, 1440, 7200, 12960],
  e2eAccelerationEligible: false,
  currentStep: 0,
  stopReason: null,
  stoppedAt: null,
  completedAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  idempotencyKey: `crm-follow-up:${lead.id}`,
  attempts: [
    {
      id: "attempt_1",
      sequenceId: "sequence_1",
      leadId: lead.id,
      stepIndex: 0,
      kind: "FIRST_EMAIL",
      status: "SCHEDULED",
      scheduledAt: new Date("2026-09-28T10:00:00.000Z").toISOString(),
      subject: "Following up about CRM",
      idempotencyKey: "follow-up-attempt:sequence_1:0",
      domainEventId: "domain_event_1",
      outboundEmailId: null,
      zohoSyncStatus: "NOT_REQUIRED",
      zohoLastError: null,
      sentAt: null,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const acceleratedFollowUpSequence = {
  ...followUpSequence,
  cadenceMode: "E2E_ACCELERATED_MINUTES",
  cadenceOffsetsMinutes: [0, 1, 3, 5],
  e2eAccelerationEligible: false,
  attempts: followUpSequence.attempts.map((attempt) => ({
    ...attempt,
    scheduledAt: new Date("2026-09-28T10:01:00.000Z").toISOString()
  }))
};

const completedFollowUpSequence = {
  ...followUpSequence,
  status: "COMPLETED",
  completedAt: new Date().toISOString(),
  attempts: followUpSequence.attempts.map((attempt) => ({
    ...attempt,
    status: "SENT",
    sentAt: new Date().toISOString(),
    outboundEmailId: "outbound_1"
  }))
};

const generatedProposal = {
  id: "proposal_generated_1",
  leadId: lead.id,
  dealId: null,
  title: "AI Sales Automation Proposal",
  serviceType: "GENERAL",
  status: "WAITING_APPROVAL",
  currentVersionId: "proposal_version_1",
  approvedVersionId: null,
  approvedByUserId: null,
  approvedAt: null,
  sentByUserId: null,
  sentAt: null,
  sentOutboundEmailId: null,
  zohoTimelineSyncStatus: "NOT_REQUIRED",
  zohoTimelineLastError: null,
  idempotencyKey: "proposal-from-generation:crm-proposal-generation:GENERAL:lead_1",
  createdByUserId: adminUser.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lead,
  deal: null,
  createdBy: adminUser,
  approvedBy: null,
  sentBy: null,
  currentVersion: {
    id: "proposal_version_1",
    proposalId: "proposal_generated_1",
    version: 1,
    title: "AI Sales Automation Proposal",
    content: "Grounded proposal content from persisted qualification and approved knowledge.",
    editSummary: "AI-generated general proposal draft",
    createdByUserId: adminUser.id,
    createdAt: new Date().toISOString()
  },
  approvedVersion: null,
  versions: [],
  statusChanges: [
    {
      id: "proposal_status_1",
      proposalId: "proposal_generated_1",
      fromStatus: "DRAFT",
      toStatus: "WAITING_APPROVAL",
      actorUserId: adminUser.id,
      reason: "AI-generated proposal requires human approval",
      createdAt: new Date().toISOString()
    }
  ]
};

const takeoverBriefing = {
  takeover: {
    id: "takeover_1",
    leadId: lead.id,
    conversationId: conversation.id,
    takenOverByUserId: adminUser.id,
    status: "ACTIVE",
    reason: "Manual review",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    takenOverBy: adminUser
  },
  lead,
  requirements: {
    requirement: "Needs a production CRM workspace",
    serviceInterest: "CRM",
    nextAction: "Schedule discovery",
    nextActionAt: null
  },
  conversationSummary: {
    conversationId: conversation.id,
    mode: "HUMAN",
    status: "OPEN",
    lastMessageAt: conversation.lastMessageAt,
    messageCount: 1,
    recentMessages: [inboundMessage]
  },
  qualification: {
    id: "qualification_1",
    leadId: lead.id,
    need: "CRM workflow automation",
    requirement: "Production CRM workspace with automation",
    budget: "Custom pricing",
    budgetBand: null,
    authority: "Founder",
    timeline: "This quarter",
    businessFit: "Strong fit",
    decisionMakerIdentified: true,
    urgency: "High",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    evidence: []
  },
  proposalContext: {
    proposals: [
      {
        id: "proposal_1",
        leadId: lead.id,
        dealId: null,
        title: "CRM Automation Proposal",
        serviceType: "GENERAL",
        status: "WAITING_APPROVAL",
        currentVersionId: null,
        approvedVersionId: null,
        approvedByUserId: null,
        approvedAt: null,
        sentByUserId: null,
        sentAt: null,
        sentOutboundEmailId: null,
        zohoTimelineSyncStatus: "NOT_REQUIRED",
        zohoTimelineLastError: null,
        idempotencyKey: null,
        createdByUserId: adminUser.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lead,
        deal: null,
        currentVersion: null,
        approvedVersion: null,
        versions: [],
        statusChanges: []
      }
    ]
  },
  dealContext: {
    deal: {
      id: "deal_1",
      leadId: lead.id,
      stageId: qualifiedStage.id,
      ownerId: adminUser.id,
      value: "12000",
      currency: "USD",
      probability: 50,
      status: "OPEN",
      proposalStatus: null,
      wonReason: null,
      lostReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lead,
      stage: qualifiedStage,
      owner: adminUser
    }
  },
  latestActions: [
    {
      id: "activity_takeover",
      leadId: lead.id,
      actorUserId: adminUser.id,
      type: "HUMAN_TAKEOVER",
      description: "Human takeover started",
      createdAt: new Date().toISOString(),
      actorUser: adminUser
    }
  ]
};

const negotiationNotification = {
  id: "notification_1",
  type: "NEGOTIATION_HANDOFF",
  status: "UNREAD",
  severity: "WARNING",
  escalationStatus: "NONE",
  title: "Negotiation handoff required",
  body: "Prospect is negotiating price and needs the assigned owner to respond.",
  assignedToUserId: adminUser.id,
  readByUserId: null,
  acknowledgedByUserId: null,
  escalatedByUserId: null,
  leadId: lead.id,
  conversationId: conversation.id,
  negotiationHandoffId: "handoff_1",
  sourceEntityType: "NegotiationHandoff",
  sourceEntityId: "handoff_1",
  readAt: null,
  acknowledgedAt: null,
  escalatedAt: null,
  escalationDueAt: null,
  escalationReason: null,
  escalationEvidence: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  negotiationHandoff: {
    id: "handoff_1",
    leadId: lead.id,
    conversationId: conversation.id,
    replyProcessingRunId: "reply_run_1",
    assignedOwnerId: adminUser.id,
    status: "ACTIVE",
    summary: "Prospect is negotiating price and needs the assigned owner to respond.",
    failureCode: null,
    failureMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assignedOwner: adminUser
  }
};

const leadBriefing = {
  id: "briefing_1",
  kind: "LEAD",
  leadId: lead.id,
  meetingRequestId: null,
  actorUserId: adminUser.id,
  status: "COMPLETED",
  provider: "test-double",
  model: "test-double",
  inputContext: {},
  evidence: [
    {
      id: "lead:lead_1",
      sourceType: "LEAD",
      title: "Lead facts",
      text: "Needs a production CRM workspace"
    }
  ],
  approvedKnowledge: [],
  output: {
    summary: "Lead needs a production CRM workspace.",
    requirements: "Needs a production CRM workspace",
    budget: null,
    timeline: null,
    decisionContext: "Founder is involved.",
    recentCommunication: "Prospect asked about CRM workflow automation.",
    qualification: "CRM workflow automation",
    proposalDealContext: null,
    meetingContext: null,
    recommendedNextAction: "Prepare a human-reviewed discovery note.",
    usedKnowledgeIds: [],
    evidence: [{ sourceId: "lead:lead_1", quote: "Needs a production CRM workspace" }],
    requiresHumanReview: true,
    unknowns: ["budget", "timeline"]
  },
  summary: "Lead needs a production CRM workspace.",
  recommendedNextAction: "Prepare a human-reviewed discovery note.",
  failureCode: null,
  failureMessage: null,
  idempotencyKey: "briefing:lead:lead_1:test",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const currentMeetingRequest = {
  id: "meeting_current",
  leadId: lead.id,
  contactId: lead.contactId,
  conversationId: conversation.id,
  ownerId: adminUser.id,
  requestedByUserId: adminUser.id,
  confirmedByUserId: null,
  status: "CONFIRMATION_REQUIRED",
  title: "Meeting with Priya Prospect",
  description: "Prospect asked to schedule a meeting.",
  timeZone: "Asia/Kolkata",
  durationMinutes: 30,
  slotMinutes: 30,
  windowStart: "2026-09-30T04:30:00.000Z",
  windowEnd: "2026-09-30T05:30:00.000Z",
  selectedSlotId: null,
  provider: "GOOGLE_CALENDAR",
  providerMeetingId: "google_event_1",
  providerMeetingUrl: "https://calendar.google.test/verified/google_event_1",
  providerCalendarId: "primary",
  providerOrganizerEmail: "calendar-owner@example.test",
  providerSyncStatus: "NOT_REQUIRED",
  providerLastError: null,
  zohoSyncStatus: "NOT_REQUIRED",
  zohoLastError: null,
  partyNotificationStatus: "NOT_REQUIRED",
  partyNotificationNote: "External party notification semantics remain blocked by OC-09",
  confirmedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lead,
  owner: adminUser,
  requestedBy: adminUser,
  confirmedBy: null,
  slots: [
    {
      id: "meeting_slot_1",
      meetingRequestId: "meeting_current",
      startsAt: "2026-09-30T04:30:00.000Z",
      endsAt: "2026-09-30T05:00:00.000Z",
      timeZone: "Asia/Kolkata",
      status: "PROPOSED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "meeting_slot_2",
      meetingRequestId: "meeting_current",
      startsAt: "2026-09-30T05:00:00.000Z",
      endsAt: "2026-09-30T05:30:00.000Z",
      timeZone: "Asia/Kolkata",
      status: "PROPOSED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]
};

const historicalFailedMeetingRequest = {
  ...currentMeetingRequest,
  id: "meeting_failed",
  status: "ATTENTION_REQUIRED",
  providerLastError: "Google Calendar is missing required configuration",
  idempotencyKey: "meeting-request:reply-processing:failed",
  slots: [],
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  updatedAt: new Date(Date.now() - 60_000).toISOString()
};

const actionDashboard = {
  generatedAt: new Date().toISOString(),
  pendingProposalApprovals: [
    {
      id: "proposal:proposal_1",
      type: "PROPOSAL_APPROVAL",
      severity: "WARNING",
      title: "Proposal waiting for approval",
      detail: "CRM Automation Proposal",
      status: "WAITING_APPROVAL",
      leadId: lead.id,
      conversationId: null,
      proposalId: "proposal_1",
      sourceEntityType: "Proposal",
      sourceEntityId: "proposal_1",
      occurredAt: new Date().toISOString(),
      lead
    }
  ],
  negotiationAndTakeoverAlerts: [
    {
      id: "notification:notification_1",
      type: "NEGOTIATION_HANDOFF",
      severity: "WARNING",
      title: "Negotiation handoff required",
      detail: "Prospect is negotiating price and needs the assigned owner to respond.",
      status: "UNREAD",
      leadId: lead.id,
      conversationId: conversation.id,
      proposalId: null,
      sourceEntityType: "NegotiationHandoff",
      sourceEntityId: "handoff_1",
      occurredAt: new Date().toISOString(),
      lead
    }
  ],
  failuresRequiringAttention: [
    {
      id: "follow-up-sequence:sequence_1",
      type: "FAILURE",
      severity: "CRITICAL",
      title: "Follow-up sequence requires attention",
      detail: "PROVIDER_ERROR: Provider rejected follow-up dispatch.",
      status: "ATTENTION_REQUIRED",
      leadId: lead.id,
      conversationId: conversation.id,
      proposalId: null,
      sourceEntityType: "FollowUpSequence",
      sourceEntityId: "sequence_1",
      occurredAt: new Date().toISOString(),
      lead
    }
  ],
  meetings: {
    status: "NOT_AVAILABLE",
    items: [],
    message:
      "Meeting and calendar orchestration starts in R20/R21; no persisted meeting action source exists yet."
  },
  actionItems: [] as unknown[],
  summary: {
    pendingProposalApprovals: 1,
    negotiationAndTakeoverAlerts: 1,
    failuresRequiringAttention: 1,
    meetings: 0,
    totalActionItems: 3
  }
};

actionDashboard.actionItems = [
  ...actionDashboard.pendingProposalApprovals,
  ...actionDashboard.negotiationAndTakeoverAlerts,
  ...actionDashboard.failuresRequiringAttention
];

const operationsDashboard = {
  generatedAt: new Date().toISOString(),
  providerHealth: [
    {
      key: "zoho",
      label: "Zoho Bigin",
      provider: "ZOHO_BIGIN",
      status: "CONFIGURED",
      configured: true,
      checkedAt: new Date().toISOString(),
      missingConfig: [],
      lastError: null,
      evidence: "LIVE_HEALTH_CHECK"
    },
    {
      key: "ai",
      label: "AI Provider",
      provider: "GEMINI",
      status: "CONFIGURED",
      configured: true,
      checkedAt: new Date().toISOString(),
      missingConfig: [],
      lastError: null,
      evidence: "CONFIG_ONLY"
    }
  ],
  work: {
    statusCounts: [{ status: "ATTENTION_REQUIRED", count: 1 }],
    queuedCount: 2,
    failedCount: 0,
    attentionRequiredCount: 1,
    recentProblemItems: [
      {
        id: "event_1",
        type: "FOLLOWUP_DUE",
        status: "ATTENTION_REQUIRED",
        detail: "Provider rejected follow-up dispatch.",
        occurredAt: new Date().toISOString()
      }
    ]
  },
  unsyncedRecords: {
    total: 1,
    byStatus: [{ provider: "ZOHO_BIGIN", status: "FAILED", count: 1 }]
  },
  providerErrors: [
    {
      id: "mapping_1",
      provider: "ZOHO_BIGIN",
      source: "Mapping: LEAD",
      status: "FAILED",
      message: "Zoho mapping failed to sync",
      occurredAt: new Date().toISOString()
    }
  ],
  usage: [
    {
      key: "email-sent",
      label: "Provider-confirmed sent emails",
      provider: "EMAIL",
      count: 4,
      unit: "emails",
      period: "ALL_TIME",
      costAmount: null,
      currency: null,
      costUnavailableReason: "No provider billing feed or token-cost evidence is persisted for R28"
    }
  ]
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function leadPage(items = [lead]): unknown {
  return {
    items,
    page: 1,
    pageSize: 10,
    total: items.length,
    totalPages: 1
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function crmFetch(input: RequestInfo | URL): Promise<Response> {
  const url = requestUrl(input);

  if (url.endsWith("/api/auth/me")) {
    return Promise.resolve(jsonResponse(adminUser));
  }

  if (url.endsWith("/api/action-dashboard")) {
    return Promise.resolve(jsonResponse(actionDashboard));
  }

  if (url.endsWith("/api/operations/dashboard")) {
    return Promise.resolve(jsonResponse(operationsDashboard));
  }

  if (url.endsWith("/api/integrations/zoho-bigin/sync/leads-contacts")) {
    return Promise.resolve(
      jsonResponse({
        provider: "ZOHO_BIGIN",
        status: "COMPLETED",
        runId: "sync_run_1",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        totalRecords: 1,
        succeededRecords: 1,
        failedRecords: 0,
        skippedRecords: 0,
        pagesFetched: 1,
        lastError: null
      })
    );
  }

  if (url.includes("/api/leads?")) {
    return Promise.resolve(jsonResponse(leadPage()));
  }

  if (url.endsWith("/api/pipeline/stages")) {
    return Promise.resolve(jsonResponse([newStage, qualifiedStage]));
  }

  if (url.endsWith("/api/users")) {
    return Promise.resolve(jsonResponse([adminUser, repUser]));
  }

  if (url.endsWith("/api/leads/lead_1")) {
    return Promise.resolve(jsonResponse(lead));
  }

  if (url.endsWith("/api/leads/lead_1/qualification")) {
    return Promise.resolve(jsonResponse(leadQualification));
  }

  if (url.endsWith("/api/leads/lead_1/activities")) {
    return Promise.resolve(
      jsonResponse([
        {
          id: "activity_1",
          leadId: lead.id,
          actorUserId: adminUser.id,
          type: "STAGE_CHANGED",
          description: "Stage changed from New to Qualified",
          createdAt: new Date().toISOString(),
          actorUser: adminUser
        },
        {
          id: "activity_2",
          leadId: lead.id,
          actorUserId: null,
          type: "MESSAGE_RECEIVED",
          description: "Inbound prospect message recorded",
          createdAt: new Date().toISOString(),
          actorUser: null
        }
      ])
    );
  }

  if (url.includes("/api/notifications?")) {
    return Promise.resolve(jsonResponse([negotiationNotification]));
  }

  if (url.endsWith("/api/notifications/notification_1/read")) {
    return Promise.resolve(jsonResponse({ ...negotiationNotification, status: "READ", readAt: new Date().toISOString(), readByUserId: adminUser.id }));
  }

  if (url.endsWith("/api/notifications/notification_1/acknowledge")) {
    return Promise.resolve(jsonResponse({
      ...negotiationNotification,
      status: "ACKNOWLEDGED",
      acknowledgedAt: new Date().toISOString(),
      acknowledgedByUserId: adminUser.id
    }));
  }

  if (url.includes("/api/briefings?")) {
    return Promise.resolve(jsonResponse([leadBriefing]));
  }

  if (url.includes("/api/meetings/requests?leadId=lead_1")) {
    return Promise.resolve(jsonResponse([]));
  }

  if (url.includes("/api/proposals?")) {
    return Promise.resolve(jsonResponse([]));
  }

  if (url.endsWith("/api/briefings/leads/lead_1/generate")) {
    return Promise.resolve(jsonResponse({ ...leadBriefing, id: "briefing_2" }));
  }

  if (url.includes("/api/conversations?")) {
    return Promise.resolve(jsonResponse([conversation]));
  }

  if (url.endsWith("/api/followups/leads/lead_1")) {
    return Promise.resolve(jsonResponse([]));
  }

  if (url.endsWith("/api/conversations/conversation_1/messages")) {
    return Promise.resolve(jsonResponse([inboundMessage]));
  }

  if (url.endsWith("/api/conversations/conversation_1/mode")) {
    return Promise.resolve(jsonResponse({ ...conversation, mode: "HUMAN" }));
  }

  if (url.endsWith("/api/leads/lead_1/stage")) {
    return Promise.resolve(
      jsonResponse({ ...lead, stageId: qualifiedStage.id, stage: qualifiedStage })
    );
  }

  if (url.endsWith("/api/leads/lead_1/assign")) {
    return Promise.resolve(jsonResponse({ ...lead, ownerId: repUser.id, owner: repUser }));
  }

  return Promise.resolve(jsonResponse(leadPage()));
}

function mockCrmFetch(): MockInstance<typeof window.fetch> {
  return vi.spyOn(window, "fetch").mockImplementation(crmFetch);
}

async function openCrm(): Promise<void> {
  fireEvent.click(await screen.findByText("CRM"));
}

function storeAuth(user = adminUser): void {
  window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
  window.localStorage.setItem("shilabs.user", JSON.stringify(user));
}

describe("web app", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the login page when no user is authenticated", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "AI Sales Engine" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("finishes workspace initialization when a filter refresh completes first", async () => {
    storeAuth();
    window.history.replaceState(null, "", "/crm");
    let finishStages!: (response: Response) => void;
    const stagesResponse = new Promise<Response>((resolve) => { finishStages = resolve; });
    let filtered = false;
    vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/pipeline/stages")) return stagesResponse;
      if (url.includes("/api/leads?") && new URL(url).searchParams.get("search") === "filtered") {
        filtered = true;
        return Promise.resolve(jsonResponse(leadPage([
          { ...lead, company: { ...lead.company, name: "Filtered company" } }
        ])));
      }
      return crmFetch(input);
    });
    render(<App />);
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search leads" }), {
      target: { value: "filtered" }
    });
    await waitFor(() => expect(filtered).toBe(true));
    finishStages(jsonResponse([newStage, qualifiedStage]));
    await waitFor(() => expect(screen.queryByText("Loading CRM")).toBeNull());
    expect(within(screen.getByRole("table", { name: "Leads list" })).getByText("Filtered company")).toBeTruthy();
    expect(within(screen.getByLabelText("Change lead stage")).getByRole("option", { name: "Qualified" })).toBeTruthy();
  });

  it("shows the authenticated app shell after login", async () => {
    vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);

      if (url.endsWith("/api/auth/login")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: "header.payload.signature",
              user: adminUser
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      return crmFetch(input);
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "admin@example.local" }
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "CorrectHorse123!" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByText("Development Admin")).toBeTruthy();
    });
    expect(screen.getByText("Users")).toBeTruthy();
    expect(await screen.findByText("Sales Engineer Actions")).toBeTruthy();
    expect(screen.getAllByText("Proposal waiting for approval").length).toBeGreaterThan(0);
    await openCrm();
    expect(await screen.findAllByText("Shilabs Prospect")).toHaveLength(2);
  });

  it("validates a stored session before showing the authenticated shell", async () => {
    storeAuth();
    const fetchSpy = mockCrmFetch();

    render(<App />);

    expect(screen.getByText("Checking session")).toBeTruthy();
    expect(await screen.findByText("Development Admin")).toBeTruthy();
    expect(fetchSpy.mock.calls.some(([input]) => requestUrl(input).endsWith("/api/auth/me"))).toBe(
      true
    );
    expect(await screen.findByText("Sales Engineer Actions")).toBeTruthy();
  });

  it("clears stored auth and returns to login when session validation returns 401", async () => {
    storeAuth();
    vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/auth/me")) {
        return Promise.resolve(
          new Response(JSON.stringify({ code: "AUTHENTICATION_ERROR" }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      return crmFetch(input);
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(window.localStorage.getItem("shilabs.accessToken")).toBeNull();
  });

  it("preserves stored auth and shows retry when session validation cannot reach the API", async () => {
    storeAuth();
    vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/auth/me")) {
        return Promise.reject(new TypeError("API unavailable"));
      }
      return crmFetch(input);
    });

    render(<App />);

    expect(await screen.findByText("Service unavailable")).toBeTruthy();
    expect(
      screen.getByText("Your saved session is preserved. Retry once the API is back online.")
    ).toBeTruthy();
    expect(window.localStorage.getItem("shilabs.accessToken")).toBe("header.payload.signature");
  });

  it("recovers automatically when retry validation succeeds after API restart", async () => {
    storeAuth();
    let authMeAttempts = 0;
    vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/auth/me")) {
        authMeAttempts += 1;
        if (authMeAttempts === 1) {
          return Promise.reject(new TypeError("API unavailable"));
        }
        return Promise.resolve(jsonResponse(adminUser));
      }
      return crmFetch(input);
    });

    render(<App />);

    expect(await screen.findByText("Service unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Development Admin")).toBeTruthy();
    expect(authMeAttempts).toBeGreaterThanOrEqual(2);
  });

  it("hydrates the top-level shell view from the URL on refresh", async () => {
    storeAuth();
    window.history.replaceState(null, "", "/operations");
    mockCrmFetch();

    render(<App />);

    expect(await screen.findByText("Operations Dashboard")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Operations/i }).className).toContain("active-nav");
  });

  it("clears auth on runtime 401 from an authenticated API request", async () => {
    storeAuth();
    vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/auth/me")) {
        return Promise.resolve(jsonResponse(adminUser));
      }
      if (url.endsWith("/api/action-dashboard")) {
        return Promise.resolve(jsonResponse(actionDashboard));
      }
      if (url.includes("/api/leads?")) {
        return Promise.resolve(
          new Response(JSON.stringify({ code: "AUTHENTICATION_ERROR" }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      return crmFetch(input);
    });

    render(<App />);
    await openCrm();

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(window.localStorage.getItem("shilabs.accessToken")).toBeNull();
  });

  it("clears authenticated state on logout", async () => {
    storeAuth({
      id: "user_1",
      email: "rep@example.local",
      firstName: "Sales",
      lastName: "Rep",
      role: "SALES_REP",
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/auth/me")) {
        return Promise.resolve(jsonResponse(adminUser));
      }
      if (url.endsWith("/api/auth/logout")) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return crmFetch(input);
    });

    render(<App />);

    expect(await screen.findByText("Dashboard")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    });
    expect(window.localStorage.getItem("shilabs.accessToken")).toBeNull();
  });

  it("loads lead list and filters with real API requests", async () => {
    window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
    window.localStorage.setItem("shilabs.user", JSON.stringify(adminUser));
    const fetchSpy = mockCrmFetch();

    render(<App />);
    await openCrm();

    expect(await screen.findAllByText("Shilabs Prospect")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Search leads"), {
      target: { value: "crm" }
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/leads?"),
        expect.objectContaining({})
      );
    });
  });

  it("lets an admin run the existing Zoho lead/contact sync from the CRM workspace", async () => {
    window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
    window.localStorage.setItem("shilabs.user", JSON.stringify(adminUser));
    const fetchSpy = mockCrmFetch();

    render(<App />);
    await openCrm();

    expect(await screen.findAllByText("Shilabs Prospect")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Sync Zoho" }));

    expect(await screen.findByText("Zoho sync completed: 1/1 imported")).toBeTruthy();
    const toast = await screen.findByRole("status");
    expect(toast.textContent).toContain("Zoho sync completed");
    expect(toast.textContent).toContain("1/1 records imported");
    expect(
      fetchSpy.mock.calls.some(
        ([input, init]) =>
          requestUrl(input).endsWith("/api/integrations/zoho-bigin/sync/leads-contacts") &&
          init?.method === "POST"
      )
    ).toBe(true);
  });

  it("surfaces negotiation handoff alerts in the sales workspace", async () => {
    window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
    window.localStorage.setItem("shilabs.user", JSON.stringify(adminUser));
    const fetchSpy = mockCrmFetch();

    render(<App />);
    await openCrm();

    expect(await screen.findByText("Negotiation handoff required")).toBeTruthy();
    expect(
      screen.getByText("Prospect is negotiating price and needs the assigned owner to respond.")
    ).toBeTruthy();
    expect(screen.getByText("UNREAD")).toBeTruthy();
    expect(
      fetchSpy.mock.calls.some(([input]) =>
        requestUrl(input).includes("/api/notifications?leadId=lead_1")
      )
    ).toBe(true);
  });

  it("loads lead detail and persists stage and owner changes", async () => {
    window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
    window.localStorage.setItem("shilabs.user", JSON.stringify(adminUser));
    const fetchSpy = mockCrmFetch();

    render(<App />);
    await openCrm();

    expect(await screen.findByText("Needs a production CRM workspace")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Change lead stage"), {
      target: { value: qualifiedStage.id }
    });
    fireEvent.change(screen.getByLabelText("Assign owner"), {
      target: { value: repUser.id }
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/leads/lead_1/stage"),
        expect.objectContaining({ method: "PATCH" })
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/leads/lead_1/assign"),
        expect.objectContaining({ method: "PATCH" })
      );
    });
  });

  it("displays persisted M10 qualification signals instead of legacy lead placeholders", async () => {
    storeAuth();
    window.history.replaceState(null, "", "/crm/leads/lead_1?tab=Qualification");
    const fetchSpy = mockCrmFetch();

    render(<App />);

    expect(await screen.findByText("Qualification signals")).toBeTruthy();
    expect(screen.getByText("AI sales automation for website leads")).toBeTruthy();
    expect(screen.getByText("Automated lead follow-up and qualification")).toBeTruthy();
    expect(screen.getByText("INR 100000 per month")).toBeTruthy();
    expect(screen.getByText("Founder is the final decision maker")).toBeTruthy();
    expect(screen.getByText("Launch within 30 days")).toBeTruthy();
    expect(screen.getByText("Strong fit for automated follow-up")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(screen.queryByText("Needs a production CRM workspace")).toBeNull();
    expect(
      fetchSpy.mock.calls.some(([input]) =>
        requestUrl(input).endsWith("/api/leads/lead_1/qualification")
      )
    ).toBe(true);
  });

  it("generates a grounded proposal through the existing R15 path and keeps approval gated", async () => {
    storeAuth();
    window.history.replaceState(null, "", "/crm/leads/lead_1?tab=Proposals");
    let generated = false;
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input, init) => {
      const url = requestUrl(input);

      if (url.endsWith("/api/proposals/generate") && init?.method === "POST") {
        generated = true;
        return Promise.resolve(
          jsonResponse({
            run: {
              id: "proposal_generation_run_1",
              leadId: lead.id,
              dealId: null,
              proposalId: generatedProposal.id,
              actorUserId: adminUser.id,
              kind: "GENERAL",
              status: "COMPLETED",
              provider: "test-provider",
              model: "test-model",
              missingFields: [],
              failureCode: null,
              failureMessage: null,
              idempotencyKey: "crm-proposal-generation:GENERAL:lead_1",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              proposal: generatedProposal
            },
            proposal: generatedProposal
          })
        );
      }

      if (url.includes("/api/proposals?")) {
        return Promise.resolve(jsonResponse(generated ? [generatedProposal] : []));
      }

      if (url.includes("/api/agent-feedback/corrections")) {
        return Promise.resolve(jsonResponse([]));
      }

      return crmFetch(input);
    });

    render(<App />);

    expect(await screen.findByText("No proposals")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Generate grounded proposal" }));

    expect(await screen.findByRole("heading", { name: "AI Sales Automation Proposal" })).toBeTruthy();
    expect(screen.getAllByText("WAITING APPROVAL").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Grounded proposal content from persisted qualification and approved knowledge.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(
      fetchSpy.mock.calls.some(
        ([input, init]) =>
          requestUrl(input).endsWith("/api/proposals/generate") &&
          init?.method === "POST" &&
          init.body ===
            JSON.stringify({
              leadId: lead.id,
              kind: "GENERAL",
              idempotencyKey: "crm-proposal-generation:GENERAL:lead_1"
            })
      )
    ).toBe(true);
    expect(
      fetchSpy.mock.calls.some(([input]) => requestUrl(input).endsWith("/api/proposals/proposal_generated_1/approve"))
    ).toBe(false);
    expect(
      fetchSpy.mock.calls.some(([input]) => requestUrl(input).endsWith("/api/proposals/proposal_generated_1/send"))
    ).toBe(false);
  });

  it("shows safe API error toasts once for repeated proposal generation failures", async () => {
    storeAuth();
    window.history.replaceState(null, "", "/crm/leads/lead_1?tab=Proposals");
    let generateCalls = 0;
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input, init) => {
      const url = requestUrl(input);

      if (url.endsWith("/api/proposals/generate") && init?.method === "POST") {
        generateCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              code: "VALIDATION_ERROR",
              message: "Approved knowledge is required"
            }),
            {
              headers: { "content-type": "application/json" },
              status: 400
            }
          )
        );
      }

      if (url.includes("/api/proposals?")) {
        return Promise.resolve(jsonResponse([]));
      }

      if (url.includes("/api/agent-feedback/corrections")) {
        return Promise.resolve(jsonResponse([]));
      }

      return crmFetch(input);
    });

    render(<App />);

    expect(await screen.findByText("No proposals")).toBeTruthy();
    const generateButton = await screen.findByRole("button", { name: "Generate grounded proposal" });

    fireEvent.click(generateButton);
    const toast = await screen.findByRole("alert");
    expect(toast.textContent).toContain("Proposal generation failed");
    expect(toast.textContent).toContain("Approved knowledge is required");

    await waitFor(() => expect((generateButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(generateCalls).toBe(2);
      expect(screen.getAllByText("Proposal generation failed")).toHaveLength(1);
      expect(screen.getAllByText("Approved knowledge is required")).toHaveLength(1);
    });
    expect(
      fetchSpy.mock.calls.filter(
        ([input, init]) => requestUrl(input).endsWith("/api/proposals/generate") && init?.method === "POST"
      )
    ).toHaveLength(2);
  });

  it("hydrates the complete proposal lifecycle across fresh CRM remounts", async () => {
    storeAuth();
    window.history.replaceState(null, "", "/crm/leads/lead_1?tab=Proposals");
    const baseProposal = generatedProposal as unknown as ProposalDto;
    let proposal: ProposalDto | null = null;
    let sendCalls = 0;
    const fieldValue = (label: string): string => {
      const element = screen.getByLabelText(label);
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.value;
      }
      throw new Error(`${label} is not a text field`);
    };
    const buttonDisabled = (name: string): boolean => {
      const element = screen.getByRole("button", { name });
      if (element instanceof HTMLButtonElement) {
        return element.disabled;
      }
      throw new Error(`${name} is not a button`);
    };
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input, init) => {
      const url = requestUrl(input);

      if (url.endsWith("/api/proposals/generate") && init?.method === "POST") {
        proposal = { ...baseProposal };
        return Promise.resolve(
          jsonResponse({
            run: {
              id: "proposal_generation_run_1",
              leadId: lead.id,
              dealId: null,
              proposalId: proposal.id,
              actorUserId: adminUser.id,
              kind: "GENERAL",
              status: "COMPLETED",
              provider: "test-provider",
              model: "test-model",
              missingFields: [],
              failureCode: null,
              failureMessage: null,
              idempotencyKey: "crm-proposal-generation:GENERAL:lead_1",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              proposal
            },
            proposal
          })
        );
      }

      if (url.endsWith("/api/proposals/proposal_generated_1/draft") && init?.method === "PATCH") {
        const rawBody = typeof init.body === "string" ? init.body : "{}";
        const body = JSON.parse(rawBody) as { title: string; content: string };
        const activeProposal = proposal ?? baseProposal;
        const version: NonNullable<ProposalDto["currentVersion"]> = {
          id: "proposal_version_2",
          proposalId: baseProposal.id,
          version: 2,
          title: body.title,
          content: body.content,
          editSummary: "Updated from proposal review UI",
          createdByUserId: adminUser.id,
          createdAt: new Date().toISOString()
        };
        proposal = {
          ...activeProposal,
          title: body.title,
          currentVersionId: version.id,
          currentVersion: version,
          versions: [version, ...activeProposal.versions]
        };
        return Promise.resolve(jsonResponse(proposal));
      }

      if (url.endsWith("/api/proposals/proposal_generated_1/approve") && init?.method === "POST") {
        const activeProposal = proposal ?? baseProposal;
        proposal = {
          ...activeProposal,
          status: "APPROVED",
          approvedVersionId: activeProposal.currentVersionId,
          approvedByUserId: adminUser.id,
          approvedBy: adminUser as ProposalDto["approvedBy"],
          approvedAt: new Date().toISOString(),
          approvedVersion: activeProposal.currentVersion,
          statusChanges: [
            ...activeProposal.statusChanges,
            {
              id: "proposal_status_approved",
              proposalId: baseProposal.id,
              fromStatus: "WAITING_APPROVAL",
              toStatus: "APPROVED",
              actorUserId: adminUser.id,
              reason: "Approved from proposal review UI",
              createdAt: new Date().toISOString()
            } satisfies ProposalDto["statusChanges"][number]
          ]
        };
        return Promise.resolve(jsonResponse(proposal));
      }

      if (url.endsWith("/api/proposals/proposal_generated_1/send") && init?.method === "POST") {
        sendCalls += 1;
        const sentAt = new Date().toISOString();
        const activeProposal = proposal ?? baseProposal;
        proposal = {
          ...activeProposal,
          status: "SENT",
          sentByUserId: adminUser.id,
          sentBy: adminUser as ProposalDto["sentBy"],
          sentAt,
          sentOutboundEmailId: "outbound_email_1",
          zohoTimelineSyncStatus: "SYNCED",
          statusChanges: [
            ...activeProposal.statusChanges,
            {
              id: "proposal_status_sent",
              proposalId: baseProposal.id,
              fromStatus: "APPROVED",
              toStatus: "SENT",
              actorUserId: adminUser.id,
              reason: "Approved proposal email sent through EmailProvider",
              createdAt: sentAt
            } satisfies ProposalDto["statusChanges"][number]
          ]
        };
        const sentProposal = proposal;
        return Promise.resolve(
          jsonResponse({
            proposal: sentProposal,
            outboundEmail: {
              id: "outbound_email_1",
              leadId: lead.id,
              contactId: lead.contactId,
              actorUserId: adminUser.id,
              toEmail: lead.contact.email,
              fromEmail: "sales@example.local",
              replyToEmail: null,
              subject: sentProposal.title,
              provider: "AWS_SES",
              providerMessageId: "provider-message-1",
              idempotencyKey: `proposal-send:${sentProposal.id}:${sentProposal.approvedVersionId ?? "unknown"}`,
              status: "SENT",
              failureCode: null,
              failureMessage: null,
              sentAt,
              deliveredAt: null,
              bouncedAt: null,
              complainedAt: null,
              createdAt: sentAt,
              updatedAt: sentAt
            },
            zohoTimeline: {
              provider: "ZOHO_BIGIN",
              status: "SYNCED",
              activityId: "activity_proposal_sent",
              mappingId: "mapping_1",
              externalRecordId: "zoho_timeline_1",
              lastError: null
            }
          })
        );
      }

      if (url.includes("/api/proposals?")) {
        return Promise.resolve(jsonResponse(proposal ? [proposal] : []));
      }

      if (url.includes("/api/agent-feedback/corrections")) {
        return Promise.resolve(jsonResponse([]));
      }

      return crmFetch(input);
    });

    render(<App />);
    expect(await screen.findByText("No proposals")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Generate grounded proposal" }));
    expect(await screen.findByRole("heading", { name: "AI Sales Automation Proposal" })).toBeTruthy();
    expect((await screen.findByRole("status")).textContent).toContain("Grounded proposal generated");

    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "AI Sales Automation Proposal" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate grounded proposal" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Edited AI Sales Proposal" }
    });
    fireEvent.change(screen.getByLabelText("Proposal content"), {
      target: { value: "Edited persisted proposal content." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Proposal draft saved")).toBeTruthy();

    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Edited AI Sales Proposal" })).toBeTruthy();
    expect(fieldValue("Proposal content")).toBe("Edited persisted proposal content.");

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Proposal approved")).toBeTruthy();
    expect(screen.getAllByText("APPROVED").length).toBeGreaterThanOrEqual(1);
    expect(buttonDisabled("Approve")).toBe(true);

    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Edited AI Sales Proposal" })).toBeTruthy();
    expect(screen.getAllByText("APPROVED").length).toBeGreaterThanOrEqual(1);
    expect(buttonDisabled("Send approved")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Send approved" }));
    expect(await screen.findByText("Approved proposal sent")).toBeTruthy();
    expect(screen.getAllByText("SENT").length).toBeGreaterThanOrEqual(1);
    expect(buttonDisabled("Send approved")).toBe(true);

    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Edited AI Sales Proposal" })).toBeTruthy();
    expect(screen.getAllByText("SENT").length).toBeGreaterThanOrEqual(1);
    expect(buttonDisabled("Send approved")).toBe(true);
    expect(sendCalls).toBe(1);
    expect(
      fetchSpy.mock.calls.filter(
        ([input, init]) => requestUrl(input).endsWith("/api/proposals/proposal_generated_1/send") && init?.method === "POST"
      )
    ).toHaveLength(1);
  });

  it("saves simulated inbound prospect messages from the conversation tab", async () => {
    window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
    window.localStorage.setItem("shilabs.user", JSON.stringify(adminUser));
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);

      if (url.endsWith("/api/conversations/conversation_1/messages") && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            ...inboundMessage,
            id: "message_2",
            body: "Can you build our property sales site?"
          })
        );
      }

      return crmFetch(input);
    });

    render(<App />);
    await openCrm();

    fireEvent.click(await screen.findByRole("tab", { name: "Conversation" }));
    expect(await screen.findByText("We need a new real-estate website.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Prospect message"), {
      target: { value: "Can you build our property sales site?" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save inbound" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/conversations/conversation_1/messages"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            direction: "INBOUND",
            senderType: "PROSPECT",
            body: "Can you build our property sales site?"
          })
        })
      );
      expect(screen.getByText("Can you build our property sales site?")).toBeTruthy();
    });
  });

  it("submits local E2E customer replies through inbound ingestion and reply processing", async () => {
    vi.stubEnv("VITE_APP_ENV", "e2e-local");
    storeAuth();
    window.history.replaceState(null, "", "/crm/leads/lead_1?tab=Conversation");
    let submitted = false;
    const e2eMessage = {
      ...inboundMessage,
      id: "message_e2e_reply",
      providerMessageId: "e2e-customer-reply-message",
      body: "Yes, please send pricing for the CRM rollout."
    };
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input, init) => {
      const url = requestUrl(input);

      if (url.endsWith("/api/email/e2e/customer-reply") && init?.method === "POST") {
        submitted = true;
        return Promise.resolve(
          jsonResponse({
            provider: "AWS_SES",
            status: "PROCESSED",
            inboundEmail: {
              id: "inbound_email_1",
              provider: "AWS_SES",
              providerMessageId: "e2e-customer-reply-message",
              providerEventId: "event_1",
              leadId: lead.id,
              contactId: lead.contactId,
              conversationId: conversation.id,
              messageId: e2eMessage.id,
              fromEmail: lead.contact.email,
              toEmails: ["sales@shilabs.local"],
              subject: "E2E Customer Reply",
              textBody: "Yes, please send pricing for the CRM rollout.",
              status: "PROCESSED",
              failureCode: null,
              failureMessage: null,
              replyProcessingStatus: "PENDING",
              receivedAt: new Date().toISOString(),
              processedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          })
        );
      }

      if (url.endsWith("/api/reply-processing/inbound-emails/inbound_email_1/process")) {
        return Promise.resolve(
          jsonResponse({
            id: "reply_run_1",
            leadId: lead.id,
            conversationId: conversation.id,
            messageId: e2eMessage.id,
            inboundEmailId: "inbound_email_1",
            status: "COMPLETED",
            intent: "NEGOTIATION",
            recommendedAction: "HUMAN_HANDOFF",
            confidence: "0.91",
            summary: "Prospect asked for a better commercial deal.",
            draftResponse: null,
            requiresHumanReview: true,
            humanHandoffRequired: true,
            provider: "OPENAI",
            model: "test-model",
            failureCode: null,
            failureMessage: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          })
        );
      }

      if (url.includes("/api/notifications?leadId=lead_1")) {
        return Promise.resolve(jsonResponse(submitted ? [negotiationNotification] : []));
      }

      if (url.includes("/api/meetings/requests?leadId=lead_1")) {
        return Promise.resolve(jsonResponse([]));
      }

      if (url.endsWith("/api/conversations/conversation_1/messages")) {
        return Promise.resolve(jsonResponse(submitted ? [inboundMessage, e2eMessage] : [inboundMessage]));
      }

      return crmFetch(input);
    });

    render(<App />);

    expect(await screen.findByText("We need a new real-estate website.")).toBeTruthy();
    const e2eReplyPanel = await screen.findByRole("region", { name: "E2E Customer Reply" });
    const replyTextbox = within(e2eReplyPanel).getByRole("textbox");
    fireEvent.change(replyTextbox, {
      target: { value: "Yes, please send pricing for the CRM rollout." }
    });
    fireEvent.click(within(e2eReplyPanel).getByRole("button", { name: "Submit inbound reply" }));

    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => requestUrl(input).endsWith("/api/leads/lead_1"))).toBe(
        true
      );
      expect(
        fetchSpy.mock.calls.filter(([input]) =>
          requestUrl(input).endsWith("/api/conversations/conversation_1/messages")
        ).length
      ).toBeGreaterThanOrEqual(1);
      expect(
        fetchSpy.mock.calls.some(([input]) =>
          requestUrl(input).includes("/api/meetings/requests?leadId=lead_1")
        )
      ).toBe(true);
    });
    expect(fetchSpy.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.stringContaining("/api/email/e2e/customer-reply"),
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              leadId: lead.id,
              subject: "E2E Customer Reply - Priya Prospect",
              body: "Yes, please send pricing for the CRM rollout."
            })
          })
        ],
        [
          expect.stringContaining("/api/reply-processing/inbound-emails/inbound_email_1/process"),
          expect.objectContaining({ method: "POST" })
        ]
      ])
    );
    expect(await screen.findByText("Negotiation handoff required")).toBeTruthy();
    expect(screen.getByText("Prospect is negotiating price and needs the assigned owner to respond.")).toBeTruthy();
  });

  it("hydrates current meeting slots ahead of historical scheduling failures", async () => {
    storeAuth();
    window.history.replaceState(null, "", "/crm/leads/lead_1?tab=Meetings");
    let confirmed = false;
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input, init) => {
      const url = requestUrl(input);

      if (url.includes("/api/meetings/requests?leadId=lead_1")) {
        return Promise.resolve(
          jsonResponse([
            historicalFailedMeetingRequest,
            confirmed
              ? {
                  ...currentMeetingRequest,
                  status: "CONFIRMED",
                  selectedSlotId: "meeting_slot_1",
                  confirmedAt: new Date().toISOString(),
                  slots: currentMeetingRequest.slots.map((slot, index) => ({
                    ...slot,
                    status: index === 0 ? "SELECTED" : "EXPIRED"
                  }))
                }
              : currentMeetingRequest
          ])
        );
      }

      if (url.endsWith("/api/meetings/requests/meeting_current/confirm") && init?.method === "POST") {
        confirmed = true;
        return Promise.resolve(
          jsonResponse({
            ...currentMeetingRequest,
            status: "CONFIRMED",
            selectedSlotId: "meeting_slot_1",
            confirmedAt: new Date().toISOString(),
            slots: currentMeetingRequest.slots.map((slot, index) => ({
              ...slot,
              status: index === 0 ? "SELECTED" : "EXPIRED"
            }))
          })
        );
      }

      return crmFetch(input);
    });

    render(<App />);

    expect((await screen.findByRole("button", { name: "Slots available" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Historical meeting request evidence (1)")).toBeTruthy();
    const slotButtons = await screen.findAllByRole("button", { name: /Confirm / });
    expect(slotButtons).toHaveLength(2);

    const firstSlotButton = slotButtons[0];
    if (!firstSlotButton) {
      throw new Error("Expected at least one meeting slot confirmation button");
    }
    fireEvent.click(firstSlotButton);
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([input, init]) =>
            requestUrl(input).endsWith("/api/meetings/requests/meeting_current/confirm") &&
            init?.method === "POST"
        )
      ).toBe(true);
    });
    expect(await screen.findByText("calendar-owner@example.test")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Google Calendar" }).getAttribute("href")).toBe(
      "https://calendar.google.test/verified/google_event_1"
    );
  });

  it("persists conversation mode changes from the simulator", async () => {
    window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
    window.localStorage.setItem("shilabs.user", JSON.stringify(adminUser));
    const fetchSpy = mockCrmFetch();

    render(<App />);
    await openCrm();

    fireEvent.click(await screen.findByRole("tab", { name: "Conversation" }));
    fireEvent.change(await screen.findByLabelText("AI mode"), {
      target: { value: "HUMAN" }
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/conversations/conversation_1/mode"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ mode: "HUMAN" })
        })
      );
    });
  });

  it("shows a HUMAN email reply composer and hides takeover action", async () => {
    storeAuth();
    window.history.replaceState(null, "", "/crm/leads/lead_1?tab=Conversation");
    let humanReplySent = false;
    const emailHumanConversation = { ...humanConversation, channel: "EMAIL" };
    const humanReplyMessage = {
      ...inboundMessage,
      id: "message_human_reply",
      direction: "OUTBOUND",
      senderType: "USER",
      senderUserId: adminUser.id,
      body: "Thanks, I will review commercials and respond with a revised option.",
      deliveryStatus: "SENT",
      sentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      senderUser: adminUser
    };
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input, init) => {
      const url = requestUrl(input);

      if (url.includes("/api/conversations?")) {
        return Promise.resolve(jsonResponse([emailHumanConversation]));
      }

      if (url.endsWith("/api/conversations/conversation_1/messages")) {
        return Promise.resolve(jsonResponse(humanReplySent ? [inboundMessage, humanReplyMessage] : [inboundMessage]));
      }

      if (url.endsWith("/api/conversations/conversation_1/takeover/briefing")) {
        return Promise.resolve(
          new Response(JSON.stringify({ code: "NOT_FOUND", message: "Active human takeover not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      if (url.endsWith("/api/conversations/conversation_1/human-reply") && init?.method === "POST") {
        humanReplySent = true;
        return Promise.resolve(
          jsonResponse({
            message: humanReplyMessage,
            outboundEmail: {
              id: "outbound_human_reply",
              leadId: lead.id,
              contactId: lead.contactId,
              actorUserId: adminUser.id,
              toEmail: lead.contact.email,
              fromEmail: "sales@example.local",
              replyToEmail: null,
              subject: "Re: Commercial discussion",
              provider: "AWS_SES",
              providerMessageId: "ses-human-reply",
              idempotencyKey: "human-reply:conversation_1:test",
              status: "SENT",
              failureCode: null,
              failureMessage: null,
              sentAt: new Date().toISOString(),
              deliveredAt: null,
              bouncedAt: null,
              complainedAt: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            zohoTimeline: null
          })
        );
      }

      return crmFetch(input);
    });

    render(<App />);

    const humanReplyPanel = await screen.findByRole("region", { name: "Human reply" });
    expect(humanReplyPanel).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take over" })).toBeNull();
    fireEvent.change(within(humanReplyPanel).getByRole("textbox", { name: "Human reply" }), {
      target: { value: "Thanks, I will review commercials and respond with a revised option." }
    });
    fireEvent.click(within(humanReplyPanel).getByRole("button", { name: "Send human reply" }));

    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => requestUrl(input).endsWith("/api/conversations/conversation_1/human-reply"))).toBe(
        true
      );
    });
    expect(await screen.findByText("Thanks, I will review commercials and respond with a revised option.")).toBeTruthy();
  });

  it("starts production follow-up automation from the conversation tab and shows persisted state", async () => {
    window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
    window.localStorage.setItem("shilabs.user", JSON.stringify(adminUser));
    let started = false;
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);

      if (url.endsWith("/api/followups/leads/lead_1/start")) {
        started = true;
        return Promise.resolve(jsonResponse(followUpSequence));
      }

      if (url.endsWith("/api/followups/leads/lead_1")) {
        return Promise.resolve(jsonResponse(started ? [followUpSequence] : []));
      }

      return crmFetch(input);
    });

    render(<App />);
    await openCrm();

    fireEvent.click(await screen.findByRole("tab", { name: "Conversation" }));
    expect(await screen.findByText("Follow-up automation")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start follow-up automation" }));

    expect(await screen.findByText("FIRST EMAIL")).toBeTruthy();
    expect(screen.getAllByText("ACTIVE").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("SCHEDULED")).toBeTruthy();
    expect(
      fetchSpy.mock.calls.some(
        ([input, init]) =>
          requestUrl(input).endsWith("/api/followups/leads/lead_1/start") &&
          init?.method === "POST" &&
          init.body === JSON.stringify({ idempotencyKey: "crm-follow-up:lead_1" })
      )
    ).toBe(true);
  });

  it("hydrates an existing follow-up sequence after a full browser refresh on a routed CRM lead", async () => {
    storeAuth();
    let started = false;
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);

      if (url.endsWith("/api/followups/leads/lead_1/start")) {
        started = true;
        return Promise.resolve(jsonResponse(followUpSequence));
      }

      if (url.endsWith("/api/followups/leads/lead_1")) {
        return Promise.resolve(jsonResponse(started ? [followUpSequence] : []));
      }

      return crmFetch(input);
    });

    render(<App />);
    await openCrm();
    fireEvent.click(await screen.findByRole("tab", { name: "Conversation" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start follow-up automation" }));

    expect(await screen.findByText("FIRST EMAIL")).toBeTruthy();
    expect(window.location.pathname).toBe("/crm/leads/lead_1");
    expect(window.location.search).toBe("?tab=Conversation");

    cleanup();
    render(<App />);

    expect(await screen.findByText("Follow-up automation")).toBeTruthy();
    expect(await screen.findByText("FIRST EMAIL")).toBeTruthy();
    expect(screen.getByText("ACTIVE")).toBeTruthy();
    expect(screen.getByText("SCHEDULED")).toBeTruthy();
    expect(screen.getByText("AI sales automation for website leads")).toBeTruthy();
    expect(
      fetchSpy.mock.calls.filter(([input]) =>
        requestUrl(input).endsWith("/api/followups/leads/lead_1")
      ).length
    ).toBeGreaterThanOrEqual(2);
  });

  it("hydrates CRM lead selection and persisted follow-up automation from the route", async () => {
    storeAuth();
    window.history.replaceState(null, "", "/crm/leads/lead_1?tab=Conversation");
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);

      if (url.endsWith("/api/followups/leads/lead_1")) {
        return Promise.resolve(jsonResponse([followUpSequence]));
      }

      return crmFetch(input);
    });

    render(<App />);

    expect(await screen.findByText("Follow-up automation")).toBeTruthy();
    expect(await screen.findByText("FIRST EMAIL")).toBeTruthy();
    expect(screen.getByText("ACTIVE")).toBeTruthy();
    expect(screen.getByText("SCHEDULED")).toBeTruthy();
    expect(screen.getByText("AI sales automation for website leads")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accelerate E2E" })).toBeNull();
    expect(
      fetchSpy.mock.calls.some(([input]) =>
        requestUrl(input).endsWith("/api/followups/leads/lead_1")
      )
    ).toBe(true);
  });

  it("shows no next action for completed follow-up sequences", async () => {
    storeAuth();
    window.history.replaceState(null, "", "/crm/leads/lead_1?tab=Conversation");
    vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);

      if (url.endsWith("/api/followups/leads/lead_1")) {
        return Promise.resolve(jsonResponse([completedFollowUpSequence]));
      }

      return crmFetch(input);
    });

    render(<App />);

    expect(await screen.findByText("No next action")).toBeTruthy();
    expect(screen.queryByText("FIRST EMAIL")).toBeNull();
  });

  it("lets an admin accelerate an existing active follow-up only in local E2E UI", async () => {
    vi.stubEnv("VITE_APP_ENV", "e2e-local");
    storeAuth();
    window.history.replaceState(null, "", "/crm/leads/lead_1?tab=Conversation");
    let accelerated = false;
    const eligibleFollowUpSequence = { ...followUpSequence, e2eAccelerationEligible: true };
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input, init) => {
      const url = requestUrl(input);

      if (
        url.endsWith("/api/followups/sequences/sequence_1/e2e/accelerate") &&
        init?.method === "POST"
      ) {
        accelerated = true;
        return Promise.resolve(jsonResponse(acceleratedFollowUpSequence));
      }

      if (url.endsWith("/api/followups/leads/lead_1")) {
        return Promise.resolve(
          jsonResponse(accelerated ? [acceleratedFollowUpSequence] : [eligibleFollowUpSequence])
        );
      }

      return crmFetch(input);
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Accelerate E2E" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Accelerate E2E" })).toBeNull();
    });
    expect(screen.getByText("ACTIVE")).toBeTruthy();
    expect(screen.getByText("SCHEDULED")).toBeTruthy();
    expect(
      fetchSpy.mock.calls.filter(
        ([input, init]) =>
          requestUrl(input).endsWith("/api/followups/sequences/sequence_1/e2e/accelerate") &&
          init?.method === "POST"
      )
    ).toHaveLength(1);
  });

  it("shows persisted human takeover briefing for an already-human conversation", async () => {
    window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
    window.localStorage.setItem("shilabs.user", JSON.stringify(adminUser));
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);

      if (url.includes("/api/conversations?")) {
        return Promise.resolve(jsonResponse([humanConversation]));
      }

      if (url.endsWith("/api/conversations/conversation_1/takeover/briefing")) {
        return Promise.resolve(jsonResponse(takeoverBriefing));
      }

      return crmFetch(input);
    });

    render(<App />);
    await openCrm();

    fireEvent.click(await screen.findByRole("tab", { name: "Conversation" }));

    const briefing = await screen.findByRole("region", { name: "Human takeover briefing" });
    expect(within(briefing).getByText("Human takeover active")).toBeTruthy();
    expect(within(briefing).getByText("Needs a production CRM workspace")).toBeTruthy();
    expect(within(briefing).getByText("CRM workflow automation")).toBeTruthy();
    expect(within(briefing).getByText("WAITING APPROVAL")).toBeTruthy();
    expect(within(briefing).getByText("OPEN at 50%")).toBeTruthy();
    expect(within(briefing).getByText("HUMAN TAKEOVER")).toBeTruthy();
    expect(
      fetchSpy.mock.calls.some(([input]) =>
        requestUrl(input).endsWith("/api/conversations/conversation_1/takeover/briefing")
      )
    ).toBe(true);
  });

  it("shows and generates grounded lead briefings in AI Insights", async () => {
    storeAuth();
    const fetchSpy = mockCrmFetch();

    render(<App />);
    await openCrm();

    fireEvent.click(await screen.findByRole("tab", { name: "AI Insights" }));

    expect(await screen.findByText("Lead needs a production CRM workspace.")).toBeTruthy();
    expect(screen.getByText("Needs a production CRM workspace")).toBeTruthy();
    expect(screen.getByText("Prepare a human-reviewed discovery note.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Generate briefing" }));

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(([input]) =>
          requestUrl(input).endsWith("/api/briefings/leads/lead_1/generate")
        )
      ).toBe(true);
    });
  });

  it("opens the CRM workspace from a dashboard action item", async () => {
    window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
    window.localStorage.setItem("shilabs.user", JSON.stringify(adminUser));
    const fetchSpy = mockCrmFetch();

    render(<App />);

    expect(await screen.findByText("Sales Engineer Actions")).toBeTruthy();
    const openWorkspaceButton = screen.getAllByRole("button", { name: "Open workspace" })[0];
    if (!openWorkspaceButton) {
      throw new Error("Expected dashboard open workspace button");
    }
    fireEvent.click(openWorkspaceButton);

    expect(await screen.findByText("Sales Workspace")).toBeTruthy();
    expect(await screen.findAllByText("Shilabs Prospect")).toHaveLength(2);
    expect(
      fetchSpy.mock.calls.some(([input]) => requestUrl(input).endsWith("/api/leads/lead_1"))
    ).toBe(true);
  });

  it("opens the operations dashboard for administrators", async () => {
    storeAuth();
    const fetchSpy = mockCrmFetch();

    render(<App />);

    fireEvent.click(await screen.findByText("Operations"));

    expect(await screen.findByText("Integration Health")).toBeTruthy();
    expect(screen.getByText("Zoho Bigin")).toBeTruthy();
    expect(screen.getByText("Queued And Failed Work")).toBeTruthy();
    expect(screen.getByText("Provider And Retry Errors")).toBeTruthy();
    expect(screen.getByText("Usage And Cost Evidence")).toBeTruthy();
    expect(screen.getByText("No provider billing feed or token-cost evidence is persisted for R28")).toBeTruthy();
    expect(
      fetchSpy.mock.calls.some(([input]) => requestUrl(input).endsWith("/api/operations/dashboard"))
    ).toBe(true);
  });
});
