import type {
  ActivityDto,
  AgentDashboardDto,
  AgentDetailDto,
  AiCommandCenterDto,
  CompanyDto,
  ContactDto,
  ConversationDto,
  DealDto,
  LeadDto,
  LeadIntelligenceDto,
  LeadQualificationDto,
  MeetingRequestDto,
  OrderDto,
  PipelineDto,
  ProposalDto,
  PublicUser,
  SalesActionDashboardDto,
  TaskDto,
  IntegrationDashboardDto,
  WorkflowDashboardDto,
  WorkflowDetailDto
} from "@shilabs/shared-types";

const now = "2026-10-08T08:30:00.000Z";

function requiredAt<T>(items: readonly T[], index: number, label: string): T {
  const item = items[index];
  if (!item) throw new Error(`Missing demo ${label} at index ${String(index)}`);
  return item;
}

export const demoUser: PublicUser = {
  id: "demo-admin",
  email: "manager@shilabs.demo",
  firstName: "Demo",
  lastName: "Manager",
  role: "ADMIN",
  status: "ACTIVE",
  createdAt: "2026-01-05T09:00:00.000Z",
  updatedAt: now
};

export const demoRep: PublicUser = {
  id: "demo-rep",
  email: "aisha@shilabs.demo",
  firstName: "Aisha",
  lastName: "Kapoor",
  role: "SALES_REP",
  status: "ACTIVE",
  createdAt: "2026-02-12T09:00:00.000Z",
  updatedAt: now
};

export function demoLeadIntelligence(leadId: string): LeadIntelligenceDto {
  const lead = demoLeads.find((item) => item.id === leadId) ?? demoLeads[0];
  if (!lead) throw new Error("Demo lead data is unavailable");
  const companyName = lead.company.name;
  return {
    id: `intelligence-${lead.id}`,
    leadId: lead.id,
    summary: `${companyName} is actively evaluating the proposed solution. Recent engagement and commercial context indicate a focused buying process with human review retained for commitments.`,
    primaryNeed: "Confirm solution fit, implementation scope, and the next agreed commercial step.",
    objections:
      lead.temperature === "HOT"
        ? ["Commercial approval remains pending"]
        : ["Decision timeline is not yet confirmed"],
    commitments: ["Follow up on the agreed next action without changing commercial terms"],
    nextObjective: lead.nextAction ?? "Confirm the next customer action",
    communicationStyle: "Concise, evidence-led, and specific about the requested next step.",
    healthScore: Math.max(35, Math.min(96, lead.score)),
    aiControlStatus: "ON",
    followUpMode: lead.temperature === "HOT" ? "HIGH_VALUE" : "STANDARD",
    humanInterventionRequired: lead.automationOwnershipState === "HUMAN_REQUIRED",
    preferredChannel: "EMAIL",
    customCadenceDays: [],
    contextSnapshot: { source: "preview", score: lead.score, stage: lead.stage.label },
    evidence: [
      {
        sourceId: `lead:${lead.id}`,
        sourceType: "LEAD",
        title: "CRM lead record",
        quote: `${companyName} - ${lead.stage.label} - score ${String(lead.score)}`,
        occurredAt: lead.updatedAt
      }
    ],
    lastRefreshedAt: now,
    createdAt: now,
    updatedAt: now,
    documents: [
      {
        id: `document-${lead.id}`,
        leadId: lead.id,
        title: "Commercial proposal",
        kind: "PROPOSAL",
        sourceType: "CRM",
        sourceUrl: null,
        mimeType: "text/plain",
        status: "INDEXED",
        extractedText: "Proposal scope and pricing are available for grounded review.",
        failureMessage: null,
        indexedAt: now,
        chunkCount: 1,
        createdAt: now,
        updatedAt: now
      }
    ],
    latestDecision: {
      id: `decision-${lead.id}`,
      leadId: lead.id,
      decision: lead.automationOwnershipState === "HUMAN_REQUIRED" ? "ASK_HUMAN" : "FOLLOW_UP",
      reason:
        lead.automationOwnershipState === "HUMAN_REQUIRED"
          ? "A human decision is required before automation can continue."
          : "AI ownership is active and the evidence-based follow-up interval has elapsed.",
      nextObjective: lead.nextAction,
      factors: { score: lead.score, stage: lead.stage.label },
      evidence: [],
      guardrailCode: lead.automationOwnershipState === "HUMAN_REQUIRED" ? "HUMAN_REQUIRED" : null,
      correlationId: `preview-${lead.id}`,
      createdAt: now
    }
  };
}

const stageSpecs = [
  ["new", "New", 5, "#64748b"],
  ["contacted", "Contacted", 20, "#3b82f6"],
  ["qualified", "Qualified", 50, "#0d9488"],
  ["proposal", "Proposal", 70, "#d97706"],
  ["negotiation", "Negotiation", 85, "#7c3aed"],
  ["won", "Won", 100, "#16a34a"]
] as const;

export const demoPipeline: PipelineDto = {
  id: "demo-pipeline",
  name: "Sales Pipeline",
  type: "SALES",
  isDefault: true,
  status: "ACTIVE",
  createdAt: "2026-01-05T09:00:00.000Z",
  updatedAt: now,
  stages: stageSpecs.map(([key, label, probability, color], index) => ({
    id: `stage-${key}`,
    pipelineId: "demo-pipeline",
    key: key.toUpperCase(),
    label,
    order: (index + 1) * 10,
    position: index,
    probability,
    color,
    status: "ACTIVE",
    isClosed: key === "won",
    isWon: key === "won",
    isLost: false
  }))
};

const leadSpecs = [
  [
    "Northstar Labs",
    "Maya",
    "Shah",
    "maya@northstarlabs.com",
    88,
    "HOT",
    "qualified",
    "Review enterprise proposal",
    "Technology",
    "Mumbai",
    "51-200",
    "42000"
  ],
  [
    "Meridian Health",
    "Arjun",
    "Mehta",
    "arjun@meridianhealth.in",
    76,
    "WARM",
    "proposal",
    "Confirm security requirements",
    "Healthcare",
    "Bengaluru",
    "201-500",
    "36000"
  ],
  [
    "BluePeak Finance",
    "Nina",
    "Thomas",
    "nina@bluepeak.finance",
    71,
    "WARM",
    "negotiation",
    "Finalize commercial terms",
    "Financial Services",
    "Delhi",
    "51-200",
    "58000"
  ],
  [
    "Cedar Retail",
    "Rohan",
    "Iyer",
    "rohan@cedarretail.com",
    64,
    "WARM",
    "contacted",
    "Schedule discovery call",
    "Retail",
    "Pune",
    "11-50",
    "18000"
  ],
  [
    "Orbit Logistics",
    "Sara",
    "Khan",
    "sara@orbitlogistics.io",
    58,
    "NURTURE",
    "qualified",
    "Share integration overview",
    "Logistics",
    "Hyderabad",
    "201-500",
    "27000"
  ],
  [
    "Lumen Learning",
    "Kabir",
    "Rao",
    "kabir@lumenlearning.org",
    52,
    "NURTURE",
    "new",
    "Qualify timeline and budget",
    "Education",
    "Chennai",
    "51-200",
    "15000"
  ],
  [
    "Harbor Hospitality",
    "Isha",
    "Verma",
    "isha@harborhospitality.com",
    47,
    "NURTURE",
    "contacted",
    "Send meeting recap",
    "Hospitality",
    "Goa",
    "201-500",
    "22000"
  ],
  [
    "Vertex Manufacturing",
    "Dev",
    "Patel",
    "dev@vertexmfg.in",
    81,
    "HOT",
    "proposal",
    "Approve implementation scope",
    "Manufacturing",
    "Ahmedabad",
    "501-1000",
    "74000"
  ]
] as const;

export const demoCompanies: CompanyDto[] = leadSpecs.map((item, index) => ({
  id: `company-${String(index + 1)}`,
  name: item[0],
  website: `https://${item[0].toLowerCase().replaceAll(" ", "")}.example`,
  normalizedWebsite: `${item[0].toLowerCase().replaceAll(" ", "")}.example`,
  industry: item[8],
  location: item[9],
  employeeRange: item[10],
  notes: "Active account with verified contact and engagement history.",
  createdAt: `2026-09-${String(index + 10).padStart(2, "0")}T09:00:00.000Z`,
  updatedAt: now
}));

export const demoContacts: ContactDto[] = leadSpecs.map((item, index) => ({
  id: `contact-${String(index + 1)}`,
  companyId: `company-${String(index + 1)}`,
  firstName: item[1],
  lastName: item[2],
  title: index % 2 === 0 ? "VP, Growth" : "Head of Sales",
  email: item[3],
  normalizedEmail: item[3],
  phone: `+91 98${String(42001000 + index)}`,
  normalizedPhone: `9198${String(42001000 + index)}`,
  whatsappId: null,
  source: index % 2 === 0 ? "Website" : "Referral",
  preferredChannel: "EMAIL",
  doNotContact: false,
  createdAt: requiredAt(demoCompanies, index, "company").createdAt,
  updatedAt: now
}));

export const demoLeads: LeadDto[] = leadSpecs.map((item, index) => {
  const stage = demoPipeline.stages.find((candidate) => candidate.key === item[6].toUpperCase());
  if (!stage) throw new Error(`Missing demo pipeline stage ${item[6]}`);
  const company = requiredAt(demoCompanies, index, "company");
  const contact = requiredAt(demoContacts, index, "contact");
  return {
    id: `lead-${String(index + 1)}`,
    companyId: company.id,
    contactId: contact.id,
    ownerId: index % 3 === 2 ? demoRep.id : demoUser.id,
    source: index % 2 === 0 ? "Website" : "Referral",
    status: "OPEN",
    stageId: stage.id,
    requirement: "A reliable sales workspace with automated follow-up and clear reporting.",
    serviceInterest: "AI sales automation",
    score: item[4],
    temperature: item[5],
    scoreOverrideAt: null,
    scoreOverrideByUserId: null,
    scoreOverrideReason: null,
    estimatedValue: item[11],
    currency: "USD",
    nextAction: item[7],
    nextActionAt: `2026-10-${String(9 + (index % 4)).padStart(2, "0")}T10:30:00.000Z`,
    automationOwnershipState: "AI_ACTIVE",
    automationOwnershipChangedAt: now,
    automationOwnershipReason: "DEMO_DATA",
    lastActivityAt: `2026-10-${String(8 - (index % 5)).padStart(2, "0")}T${String(9 - (index % 4)).padStart(2, "0")}:15:00.000Z`,
    createdAt: company.createdAt,
    updatedAt: now,
    company,
    contact,
    owner: index % 3 === 2 ? demoRep : demoUser,
    stage
  };
});

export const demoAiCommandCenter: AiCommandCenterDto = {
  generatedAt: now,
  metrics: {
    activeLeads: 10,
    humanRequired: 2,
    aiActive: 6,
    hotLeads: 3,
    overdueHumanActions: 1,
    proposalsPending: 2,
    meetingsToday: 3,
    pipelineValue: "284000"
  },
  humanSignals: { required: 2, overdue: 1, active: 3 },
  aiSignals: { active: 6, paused: 1, stopped: 1 },
  humanKpis: {
    averageResponseMinutes: 18.4,
    averageFirstResponseMinutes: 32.1,
    leadsHandled: 8,
    clientResponses: 14,
    proposalsSent: 3,
    meetingsBooked: 4,
    followUpsCompleted: 11,
    opportunities: 5,
    conversionRate: 20,
    revenue: "48000.00",
    averageDealValue: "48000.00",
    currency: "USD"
  },
  aiKpis: {
    followUpsSent: 22,
    repliesGenerated: 17,
    meetingsGenerated: 3,
    reengagements: 6,
    followUpConversionRate: 16.7,
    leadsRevived: 4,
    humanInterventions: 2,
    handovers: 3
  },
  recommendations: demoLeads.slice(0, 8).map((lead, index) => ({
    leadId: lead.id,
    contactName: `${lead.contact.firstName} ${lead.contact.lastName}`,
    companyName: lead.company.name,
    ownerName: lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : null,
    status: lead.status,
    stage: lead.stage.label,
    score: lead.score,
    temperature: lead.temperature,
    dealValue: lead.estimatedValue,
    currency: lead.currency,
    automationState: lead.automationOwnershipState,
    aiControlStatus: index === 6 ? "PAUSED" : "ON",
    healthScore: Math.max(35, Math.min(96, lead.score)),
    decision:
      lead.automationOwnershipState === "HUMAN_REQUIRED"
        ? "ASK_HUMAN"
        : index < 3
          ? "FOLLOW_UP"
          : "WAIT",
    recommendation:
      lead.automationOwnershipState === "HUMAN_REQUIRED"
        ? "Review the latest client response before automation resumes."
        : (lead.nextAction ?? "Monitor engagement and confirm the next objective."),
    nextObjective: lead.nextAction,
    lastActivityAt: lead.lastActivityAt
  }))
};

export const demoTasks: TaskDto[] = demoLeads.slice(0, 6).map((lead, index) => ({
  id: `task-${String(index + 1)}`,
  workspaceId: "demo-workspace",
  title: lead.nextAction ?? "Review account",
  description: `Complete the next step for ${lead.company.name}.`,
  status: index === 5 ? "COMPLETED" : index === 1 ? "IN_PROGRESS" : "OPEN",
  priority: index < 2 ? "HIGH" : "NORMAL",
  dueAt: lead.nextActionAt,
  reminderAt: lead.nextActionAt,
  assignedToUserId: lead.ownerId,
  createdByType: index % 2 === 0 ? "AGENT" : "USER",
  createdByUserId: index % 2 === 0 ? null : demoUser.id,
  createdByAgentId: index % 2 === 0 ? "agent-sales-copilot" : null,
  sourceType: "LEAD_NEXT_ACTION",
  sourceId: lead.id,
  leadId: lead.id,
  contactId: lead.contactId,
  companyId: lead.companyId,
  dealId: index < 5 ? `deal-${String(index + 1)}` : null,
  isNextAction: true,
  completedAt: index === 5 ? "2026-10-07T12:00:00.000Z" : null,
  completedByType: index === 5 ? "USER" : null,
  completedByUserId: index === 5 ? demoUser.id : null,
  metadata: {},
  correlationId: `demo-task-${String(index + 1)}`,
  createdAt: lead.createdAt,
  updatedAt: now,
  assignedToUser: lead.owner
}));

export const demoActivities: ActivityDto[] = (
  [
    ["STAGE_CHANGED", "Deal stage advanced", "Lead moved from Contacted to Qualified", "USER"],
    [
      "MESSAGE_RECEIVED",
      "Prospect replied",
      "Security and rollout questions received by email",
      "SYSTEM"
    ],
    [
      "MEETING_CONFIRMED",
      "Discovery meeting confirmed",
      "Thirty-minute discovery session booked",
      "AGENT"
    ],
    [
      "PROPOSAL_CREATED",
      "Proposal prepared",
      "Enterprise automation proposal created for review",
      "USER"
    ]
  ] as const
).map((item, index) => ({
  id: `activity-${String(index + 1)}`,
  leadId: "lead-1",
  entityType: "LEAD",
  entityId: "lead-1",
  actorType: item[3],
  actorUserId: item[3] === "USER" ? demoUser.id : null,
  actorAgentId: item[3] === "AGENT" ? "agent-meeting" : null,
  sourceType: "DEMO_PREVIEW",
  sourceId: `demo-${String(index + 1)}`,
  type: item[0],
  title: item[1],
  summary: item[2],
  description: item[2],
  metadata: {},
  occurredAt: `2026-10-${String(8 - index).padStart(2, "0")}T10:00:00.000Z`,
  correlationId: `demo-activity-${String(index + 1)}`,
  visibility: "BUSINESS",
  createdAt: `2026-10-${String(8 - index).padStart(2, "0")}T10:00:00.000Z`,
  actorUser: item[3] === "USER" ? demoUser : null
}));

export const demoQualification: LeadQualificationDto = {
  id: "qualification-1",
  leadId: "lead-1",
  need: "Unify inbound sales and follow-up operations",
  requirement: "AI-assisted qualification, proposals, and meeting coordination",
  budget: "$35,000-$50,000 annual budget",
  budgetBand: "MID_MARKET",
  authority: "VP Growth owns the decision with finance approval",
  timeline: "Target rollout this quarter",
  businessFit: "Strong operational and integration fit",
  decisionMakerIdentified: true,
  urgency: "High",
  createdAt: "2026-10-05T10:00:00.000Z",
  updatedAt: now,
  evidence: []
};

export const demoConversations: ConversationDto[] = [
  {
    id: "conversation-1",
    leadId: "lead-1",
    channel: "EMAIL",
    mode: "AUTO",
    status: "OPEN",
    lastMessageAt: "2026-10-08T07:45:00.000Z",
    createdAt: "2026-10-02T09:00:00.000Z",
    updatedAt: now,
    lead: requiredAt(demoLeads, 0, "lead")
  }
];

export const demoMeetings: MeetingRequestDto[] = [
  {
    id: "meeting-1",
    leadId: "lead-1",
    contactId: "contact-1",
    conversationId: "conversation-1",
    ownerId: demoUser.id,
    requestedByUserId: demoUser.id,
    confirmedByUserId: demoUser.id,
    status: "CONFIRMED",
    title: "Northstar discovery session",
    description: "Review rollout goals and integration requirements.",
    timeZone: "Asia/Kolkata",
    durationMinutes: 30,
    slotMinutes: 30,
    windowStart: "2026-10-10T06:30:00.000Z",
    windowEnd: "2026-10-10T07:00:00.000Z",
    selectedSlotId: "slot-1",
    provider: "GOOGLE_CALENDAR",
    providerMeetingId: "demo-calendar-event",
    providerMeetingUrl: "https://meet.google.com/demo-preview",
    providerCalendarId: "primary",
    providerOrganizerEmail: demoUser.email,
    providerSyncStatus: "SYNCED",
    providerLastError: null,
    zohoSyncStatus: "SYNCED",
    zohoLastError: null,
    partyNotificationStatus: "SYNCED",
    partyNotificationNote: null,
    confirmedAt: "2026-10-08T07:50:00.000Z",
    createdAt: "2026-10-08T07:40:00.000Z",
    updatedAt: now,
    lead: requiredAt(demoLeads, 0, "lead"),
    owner: demoUser,
    requestedBy: demoUser,
    confirmedBy: demoUser,
    slots: [
      {
        id: "slot-1",
        meetingRequestId: "meeting-1",
        startsAt: "2026-10-10T06:30:00.000Z",
        endsAt: "2026-10-10T07:00:00.000Z",
        timeZone: "Asia/Kolkata",
        status: "SELECTED",
        createdAt: "2026-10-08T07:40:00.000Z",
        updatedAt: now
      }
    ]
  }
];

export const demoDeals: DealDto[] = demoLeads.slice(0, 5).map((lead, index) => ({
  id: `deal-${String(index + 1)}`,
  pipelineId: demoPipeline.id,
  leadId: lead.id,
  stageId: lead.stageId,
  ownerId: lead.ownerId,
  value: lead.estimatedValue,
  currency: lead.currency,
  probability: lead.stage.probability,
  status: "OPEN",
  proposalStatus: index < 2 ? "SENT" : null,
  wonReason: null,
  lostReason: null,
  closeDate: `2026-11-${String(4 + index * 4).padStart(2, "0")}T12:00:00.000Z`,
  createdAt: lead.createdAt,
  updatedAt: now,
  lead,
  stage: lead.stage,
  owner: lead.owner
}));

export const demoOrders: OrderDto[] = demoLeads.slice(0, 8).map((lead, index) => {
  const deal = demoDeals[index] ?? null;
  const quantities = [3, 2, 5, 1, 4, 2, 6, 3];
  const unitPrices = [14000, 18000, 11600, 18000, 6750, 7500, 3500, 9000];
  const quantity = quantities[index] ?? 1;
  const unitPrice = unitPrices[index] ?? 1000;
  const total = quantity * unitPrice;
  const fulfillment = ["UNFULFILLED", "PROCESSING", "FULFILLED", "ON_HOLD"] as const;
  const payment = ["PAID", "PARTIALLY_PAID", "PAID", "PENDING"] as const;
  const paymentStatus = payment[index % payment.length] ?? "PENDING";
  const fulfillmentStatus = fulfillment[index % fulfillment.length] ?? "UNFULFILLED";
  const itemName =
    ["AI sales rollout", "CRM onboarding", "Automation package", "Advisory sprint"][index % 4] ??
    "Service";
  return {
    id: `order-${String(index + 1)}`,
    orderNumber: `ORD-202610-${String(index + 1).padStart(4, "0")}`,
    companyId: lead.companyId,
    contactId: lead.contactId,
    dealId: deal?.id ?? null,
    ownerId: lead.ownerId,
    paymentStatus,
    fulfillmentStatus,
    currency: lead.currency,
    subtotal: total.toFixed(2),
    total: total.toFixed(2),
    notes: index === 1 ? "Confirm onboarding date before fulfillment." : null,
    orderedAt: `2026-10-${String(8 - Math.min(index, 6)).padStart(2, "0")}T08:30:00.000Z`,
    paidAt: index % payment.length === 0 || index % payment.length === 2 ? now : null,
    fulfilledAt: index % fulfillment.length === 2 ? now : null,
    canceledAt: null,
    createdAt: lead.createdAt,
    updatedAt: now,
    company: lead.company,
    contact: lead.contact,
    deal,
    owner: lead.owner,
    items: [
      {
        id: `order-item-${String(index + 1)}`,
        orderId: `order-${String(index + 1)}`,
        name: itemName,
        description: null,
        quantity,
        unitPrice: unitPrice.toFixed(2),
        lineTotal: total.toFixed(2),
        createdAt: lead.createdAt,
        updatedAt: now
      }
    ]
  };
});

const proposalVersion = {
  id: "proposal-version-1",
  proposalId: "proposal-1",
  version: 1,
  title: "Northstar AI Sales Platform",
  content: "A phased rollout for qualification, outreach, and sales operations.",
  editSummary: "Prepared from approved qualification evidence",
  createdByUserId: demoUser.id,
  createdAt: "2026-10-07T11:00:00.000Z"
};

export const demoProposals: ProposalDto[] = [
  {
    id: "proposal-1",
    leadId: "lead-1",
    dealId: "deal-1",
    title: proposalVersion.title,
    serviceType: "AI sales automation",
    status: "SENT",
    currentVersionId: proposalVersion.id,
    approvedVersionId: proposalVersion.id,
    approvedByUserId: demoUser.id,
    approvedAt: "2026-10-07T12:00:00.000Z",
    sentByUserId: demoUser.id,
    sentAt: "2026-10-07T12:15:00.000Z",
    sentOutboundEmailId: "demo-email-1",
    zohoTimelineSyncStatus: "SYNCED",
    zohoTimelineLastError: null,
    idempotencyKey: "demo-proposal-1",
    createdByUserId: demoUser.id,
    createdAt: "2026-10-07T11:00:00.000Z",
    updatedAt: now,
    lead: requiredAt(demoLeads, 0, "lead"),
    deal: requiredAt(demoDeals, 0, "deal"),
    createdBy: demoUser,
    approvedBy: demoUser,
    sentBy: demoUser,
    currentVersion: proposalVersion,
    approvedVersion: proposalVersion,
    versions: [proposalVersion],
    statusChanges: []
  }
];

const actionItem = (id: string, title: string, detail: string, leadIndex: number) => {
  const lead = requiredAt(demoLeads, leadIndex, "lead");
  return {
    id,
    type: "NEGOTIATION_HANDOFF" as const,
    severity: "WARNING" as const,
    title,
    detail,
    status: "ACTIVE",
    leadId: lead.id,
    conversationId: null,
    proposalId: null,
    sourceEntityType: "Lead",
    sourceEntityId: lead.id,
    occurredAt: lead.lastActivityAt ?? now,
    lead
  };
};

export const demoDashboard: SalesActionDashboardDto = {
  generatedAt: now,
  pendingProposalApprovals: [],
  negotiationAndTakeoverAlerts: [
    actionItem(
      "action-1",
      "Commercial review requested",
      "BluePeak requested revised pricing terms.",
      2
    ),
    actionItem(
      "action-2",
      "Stakeholder handoff active",
      "Meridian requires a security stakeholder review.",
      1
    )
  ],
  failuresRequiringAttention: [],
  meetings: {
    status: "AVAILABLE",
    items: [
      actionItem(
        "meeting-action-1",
        "Discovery meeting confirmed",
        "Northstar Labs / Oct 10, 12:00 PM",
        0
      )
    ],
    message: "1 upcoming meeting"
  },
  actionItems: [],
  summary: {
    pendingProposalApprovals: 0,
    negotiationAndTakeoverAlerts: 2,
    failuresRequiringAttention: 0,
    meetings: 1,
    totalActionItems: 3
  }
};
demoDashboard.actionItems = [
  ...demoDashboard.negotiationAndTakeoverAlerts,
  ...demoDashboard.meetings.items
];

const agentTypes = [
  "OUTREACH",
  "REPLY_UNDERSTANDING",
  "QUALIFICATION",
  "PROPOSAL",
  "MEETING",
  "VOICE",
  "WHATSAPP",
  "SALES_COPILOT"
] as const;
export const demoAgents: AgentDashboardDto = {
  agents: agentTypes.map((type, index) => ({
    id: `agent-${type.toLowerCase().replaceAll("_", "-")}`,
    key: type.toLowerCase(),
    name: `${type
      .split("_")
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(" ")} Agent`,
    description: `Coordinates ${type.toLowerCase().replaceAll("_", " ")} using governed sales context.`,
    type,
    status: index === 5 ? "PAUSED" : "ACTIVE",
    currentVersionId: `agent-version-${String(index + 1)}`,
    draftVersionId: null,
    createdByUserId: demoUser.id,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: now,
    currentVersion: {
      id: `agent-version-${String(index + 1)}`,
      agentId: `agent-${type.toLowerCase().replaceAll("_", "-")}`,
      version: 2,
      definition: { capability: type.toLowerCase() },
      modelConfig: { model: "governed-provider" },
      toolsConfig: {},
      knowledgeConfig: {},
      publishedAt: "2026-09-15T09:00:00.000Z",
      publishedByUserId: demoUser.id,
      createdAt: "2026-09-15T09:00:00.000Z"
    },
    draftVersion: null,
    versions: [],
    executionCount: 18 + index * 7,
    successfulExecutionCount: 16 + index * 6,
    failedExecutionCount: 2 + index,
    successRate: Math.round(((16 + index * 6) / (18 + index * 7)) * 1000) / 10,
    lastExecutedAt: `2026-10-08T${String(8 - (index % 6)).padStart(2, "0")}:15:00.000Z`
  })),
  summary: {
    totalAgents: 8,
    activeAgents: 7,
    pausedAgents: 1,
    totalExecutions: 340,
    successfulExecutions: 302,
    failedExecutions: 38,
    successRate: 88.8
  }
};

export function demoAgentDetail(id: string): AgentDetailDto | null {
  const agent = demoAgents.agents.find((item) => item.id === id);
  if (!agent?.currentVersion) return null;
  const currentVersion = agent.currentVersion;
  return {
    ...agent,
    versions: [agent.currentVersion],
    executions: [0, 1, 2].map((index) => {
      const lead = requiredAt(demoLeads, index, "lead");
      return {
        id: `${id}-execution-${String(index + 1)}`,
        agentId: id,
        versionId: currentVersion.id,
        source: "SALES_PLATFORM",
        sourceEntityType: "Lead",
        sourceEntityId: lead.id,
        entityType: "Lead",
        entityId: lead.id,
        leadId: lead.id,
        status: index === 2 ? "FAILED" : "SUCCEEDED",
        startedAt: `2026-10-${String(8 - index).padStart(2, "0")}T09:00:00.000Z`,
        completedAt: `2026-10-${String(8 - index).padStart(2, "0")}T09:00:${String(index + 2).padStart(2, "0")}.000Z`,
        durationMs: 1800 + index * 450,
        summary:
          index === 2
            ? "Provider response required a retry."
            : "Business action completed and recorded.",
        result: { outcome: index === 2 ? "retry_required" : "completed" },
        evaluation: { score: index === 2 ? 62 : 94 - index * 3 },
        correlationId: `${id}-demo-${String(index + 1)}`
      };
    })
  };
}

const demoWorkflowDefinition: WorkflowDetailDto["currentVersion"] extends infer T
  ? T extends { definition: infer D }
    ? D
    : never
  : never = {
  schemaVersion: 1,
  kind: "WORKFLOW",
  nodes: [
    {
      id: "node-trigger",
      type: "TRIGGER",
      label: "Human action completed",
      position: { x: 330, y: 50 },
      config: { event: "HUMAN_ACTION_COMPLETED" }
    },
    {
      id: "node-condition",
      type: "CONDITION",
      label: "Automation allowed?",
      position: { x: 330, y: 180 },
      config: { field: "automationOwnershipState", operator: "EQUALS", value: "AI_ACTIVE" }
    },
    {
      id: "node-wait",
      type: "WAIT",
      label: "Wait for follow-up cadence",
      position: { x: 150, y: 330 },
      config: { minutes: 1440 }
    },
    {
      id: "node-agent",
      type: "AGENT_INVOKE",
      label: "Invoke Outreach Agent",
      position: { x: 150, y: 480 },
      config: { agentKey: "outreach", decision: "FOLLOW_UP" }
    },
    {
      id: "node-human",
      type: "HUMAN_APPROVAL",
      label: "Ask account owner",
      position: { x: 520, y: 330 },
      config: { decision: "ASK_HUMAN" }
    },
    {
      id: "node-end",
      type: "END",
      label: "Record outcome",
      position: { x: 330, y: 630 },
      config: { outcome: "COMPLETED" }
    }
  ],
  edges: [
    { id: "edge-1", source: "node-trigger", target: "node-condition", branch: null },
    { id: "edge-2", source: "node-condition", target: "node-wait", branch: "true" },
    { id: "edge-3", source: "node-condition", target: "node-human", branch: "false" },
    { id: "edge-4", source: "node-wait", target: "node-agent", branch: null },
    { id: "edge-5", source: "node-agent", target: "node-end", branch: null },
    { id: "edge-6", source: "node-human", target: "node-end", branch: null }
  ]
};

const demoWorkflowVersion = {
  id: "workflow-version-2",
  workflowId: "workflow-governed-follow-up",
  version: 2,
  definition: demoWorkflowDefinition,
  policyConfig: {
    service: "Sales automation",
    priority: "HIGH",
    cadenceMinutes: [1440, 2880, 4320]
  },
  publishedAt: "2026-10-06T10:00:00.000Z",
  publishedByUserId: demoUser.id,
  createdAt: "2026-10-06T09:40:00.000Z"
} satisfies NonNullable<WorkflowDetailDto["currentVersion"]>;

export const demoWorkflowDetail: WorkflowDetailDto = {
  id: "workflow-governed-follow-up",
  key: "governed-follow-up",
  name: "Governed lead follow-up",
  description:
    "Resumes follow-up after human action and routes meaningful replies back to the owner.",
  status: "PUBLISHED",
  currentVersionId: demoWorkflowVersion.id,
  draftVersionId: null,
  createdByUserId: demoUser.id,
  createdAt: "2026-09-20T09:00:00.000Z",
  updatedAt: now,
  currentVersion: demoWorkflowVersion,
  draftVersion: null,
  versions: [demoWorkflowVersion],
  executionCount: 86,
  runningCount: 3,
  lastExecutedAt: "2026-10-08T08:12:00.000Z",
  executions: [
    {
      id: "workflow-execution-1",
      workflowId: "workflow-governed-follow-up",
      versionId: demoWorkflowVersion.id,
      leadId: "lead-1",
      source: "DOMAIN_EVENT",
      status: "WAITING",
      currentNodeId: "node-wait",
      correlationId: "demo-workflow-correlation-1",
      failureCode: null,
      failureMessage: null,
      startedAt: "2026-10-08T08:12:00.000Z",
      completedAt: null,
      createdAt: "2026-10-08T08:12:00.000Z",
      steps: []
    }
  ]
};

export const demoWorkflows: WorkflowDashboardDto = {
  workflows: [demoWorkflowDetail],
  summary: { total: 1, published: 1, paused: 0, executions: 86, running: 3 }
};

export const demoIntegrations: IntegrationDashboardDto = {
  connections: [
    {
      id: "integration-bigin",
      key: "zoho-bigin",
      provider: "ZOHO_BIGIN",
      name: "Zoho Bigin",
      description: "External migration and synchronization path for CRM records.",
      category: "CRM",
      status: "CONNECTED",
      healthStatus: "HEALTHY",
      syncStatus: "SUCCEEDED",
      configured: true,
      lastCheckedAt: now,
      lastHealthyAt: now,
      lastSyncAt: "2026-10-08T08:20:00.000Z",
      lastError: null,
      createdAt: "2026-08-02T08:00:00.000Z",
      updatedAt: now
    },
    {
      id: "integration-email",
      key: "email",
      provider: "AWS_SES",
      name: "Business email",
      description: "Workspace email delivery and reply capture.",
      category: "EMAIL",
      status: "CONNECTED",
      healthStatus: "HEALTHY",
      syncStatus: "IDLE",
      configured: true,
      lastCheckedAt: now,
      lastHealthyAt: now,
      lastSyncAt: "2026-10-08T08:24:00.000Z",
      lastError: null,
      createdAt: "2026-08-03T08:00:00.000Z",
      updatedAt: now
    },
    {
      id: "integration-calendar",
      key: "google-calendar",
      provider: "GOOGLE_CALENDAR",
      name: "Google Calendar",
      description: "Meeting availability, booking, and event synchronization.",
      category: "CALENDAR",
      status: "SYNCING",
      healthStatus: "HEALTHY",
      syncStatus: "SYNCING",
      configured: true,
      lastCheckedAt: now,
      lastHealthyAt: now,
      lastSyncAt: "2026-10-08T08:28:00.000Z",
      lastError: null,
      createdAt: "2026-08-04T08:00:00.000Z",
      updatedAt: now
    },
    {
      id: "integration-whatsapp",
      key: "meta-whatsapp",
      provider: "META_WHATSAPP",
      name: "WhatsApp",
      description: "Governed WhatsApp messaging through a workspace connection.",
      category: "MESSAGING",
      status: "NEEDS_ATTENTION",
      healthStatus: "NEEDS_ATTENTION",
      syncStatus: "FAILED",
      configured: true,
      lastCheckedAt: now,
      lastHealthyAt: "2026-10-07T15:30:00.000Z",
      lastSyncAt: "2026-10-08T07:55:00.000Z",
      lastError: "Provider template approval is required before outbound delivery.",
      createdAt: "2026-08-05T08:00:00.000Z",
      updatedAt: now
    }
  ],
  catalog: [
    {
      key: "gemini",
      provider: "GEMINI",
      name: "Gemini",
      description: "Provider-independent AI capability connection.",
      category: "AI",
      configuredByEnvironment: false,
      connected: false
    },
    {
      key: "exotel",
      provider: "EXOTEL",
      name: "Exotel Voice",
      description: "Voice calling provider for supported workspaces.",
      category: "VOICE",
      configuredByEnvironment: false,
      connected: false
    }
  ],
  summary: { total: 4, connected: 2, syncing: 1, needsAttention: 1, failed: 0, disabled: 0 }
};
