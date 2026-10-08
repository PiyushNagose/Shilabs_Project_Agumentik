import type {
  ActivityDto,
  AgentDashboardDto,
  AgentDetailDto,
  CompanyDto,
  ContactDto,
  ConversationDto,
  DealDto,
  LeadDto,
  LeadQualificationDto,
  MeetingRequestDto,
  PipelineDto,
  ProposalDto,
  PublicUser,
  SalesActionDashboardDto,
  TaskDto
} from "@shilabs/shared-types";

const now = "2026-10-08T08:30:00.000Z";

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
  ["Northstar Labs", "Maya", "Shah", "maya@northstarlabs.com", 88, "HOT", "qualified", "Review enterprise proposal", "Technology", "Mumbai", "51-200", "42000"],
  ["Meridian Health", "Arjun", "Mehta", "arjun@meridianhealth.in", 76, "WARM", "proposal", "Confirm security requirements", "Healthcare", "Bengaluru", "201-500", "36000"],
  ["BluePeak Finance", "Nina", "Thomas", "nina@bluepeak.finance", 71, "WARM", "negotiation", "Finalize commercial terms", "Financial Services", "Delhi", "51-200", "58000"],
  ["Cedar Retail", "Rohan", "Iyer", "rohan@cedarretail.com", 64, "WARM", "contacted", "Schedule discovery call", "Retail", "Pune", "11-50", "18000"],
  ["Orbit Logistics", "Sara", "Khan", "sara@orbitlogistics.io", 58, "NURTURE", "qualified", "Share integration overview", "Logistics", "Hyderabad", "201-500", "27000"],
  ["Lumen Learning", "Kabir", "Rao", "kabir@lumenlearning.org", 52, "NURTURE", "new", "Qualify timeline and budget", "Education", "Chennai", "51-200", "15000"],
  ["Harbor Hospitality", "Isha", "Verma", "isha@harborhospitality.com", 47, "NURTURE", "contacted", "Send meeting recap", "Hospitality", "Goa", "201-500", "22000"],
  ["Vertex Manufacturing", "Dev", "Patel", "dev@vertexmfg.in", 81, "HOT", "proposal", "Approve implementation scope", "Manufacturing", "Ahmedabad", "501-1000", "74000"]
] as const;

export const demoCompanies: CompanyDto[] = leadSpecs.map((item, index) => ({
  id: `company-${index + 1}`,
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
  id: `contact-${index + 1}`,
  companyId: `company-${index + 1}`,
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
  createdAt: demoCompanies[index]!.createdAt,
  updatedAt: now
}));

export const demoLeads: LeadDto[] = leadSpecs.map((item, index) => {
  const stage = demoPipeline.stages.find((candidate) => candidate.key === item[6].toUpperCase())!;
  return {
    id: `lead-${index + 1}`,
    companyId: `company-${index + 1}`,
    contactId: `contact-${index + 1}`,
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
    lastActivityAt: `2026-10-0${8 - (index % 5)}T0${9 - (index % 4)}:15:00.000Z`,
    createdAt: demoCompanies[index]!.createdAt,
    updatedAt: now,
    company: demoCompanies[index]!,
    contact: demoContacts[index]!,
    owner: index % 3 === 2 ? demoRep : demoUser,
    stage
  };
});

export const demoTasks: TaskDto[] = demoLeads.slice(0, 6).map((lead, index) => ({
  id: `task-${index + 1}`,
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
  dealId: index < 5 ? `deal-${index + 1}` : null,
  isNextAction: true,
  completedAt: index === 5 ? "2026-10-07T12:00:00.000Z" : null,
  completedByType: index === 5 ? "USER" : null,
  completedByUserId: index === 5 ? demoUser.id : null,
  metadata: {},
  correlationId: `demo-task-${index + 1}`,
  createdAt: demoLeads[index]!.createdAt,
  updatedAt: now,
  assignedToUser: lead.owner
}));

export const demoActivities: ActivityDto[] = ([
  ["STAGE_CHANGED", "Deal stage advanced", "Lead moved from Contacted to Qualified", "USER"],
  ["MESSAGE_RECEIVED", "Prospect replied", "Security and rollout questions received by email", "SYSTEM"],
  ["MEETING_CONFIRMED", "Discovery meeting confirmed", "Thirty-minute discovery session booked", "AGENT"],
  ["PROPOSAL_CREATED", "Proposal prepared", "Enterprise automation proposal created for review", "USER"]
] as const).map((item, index) => ({
  id: `activity-${index + 1}`,
  leadId: "lead-1",
  entityType: "LEAD",
  entityId: "lead-1",
  actorType: item[3] as ActivityDto["actorType"],
  actorUserId: item[3] === "USER" ? demoUser.id : null,
  actorAgentId: item[3] === "AGENT" ? "agent-meeting" : null,
  sourceType: "DEMO_PREVIEW",
  sourceId: `demo-${index + 1}`,
  type: item[0] as ActivityDto["type"],
  title: item[1],
  summary: item[2],
  description: item[2],
  metadata: {},
  occurredAt: `2026-10-0${8 - index}T10:00:00.000Z`,
  correlationId: `demo-activity-${index + 1}`,
  visibility: "BUSINESS",
  createdAt: `2026-10-0${8 - index}T10:00:00.000Z`,
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

export const demoConversations: ConversationDto[] = [{
  id: "conversation-1",
  leadId: "lead-1",
  channel: "EMAIL",
  mode: "AUTO",
  status: "OPEN",
  lastMessageAt: "2026-10-08T07:45:00.000Z",
  createdAt: "2026-10-02T09:00:00.000Z",
  updatedAt: now,
  lead: demoLeads[0]!
}];

export const demoMeetings: MeetingRequestDto[] = [{
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
  lead: demoLeads[0]!,
  owner: demoUser,
  requestedBy: demoUser,
  confirmedBy: demoUser,
  slots: [{
    id: "slot-1",
    meetingRequestId: "meeting-1",
    startsAt: "2026-10-10T06:30:00.000Z",
    endsAt: "2026-10-10T07:00:00.000Z",
    timeZone: "Asia/Kolkata",
    status: "SELECTED",
    createdAt: "2026-10-08T07:40:00.000Z",
    updatedAt: now
  }]
}];

export const demoDeals: DealDto[] = demoLeads.slice(0, 5).map((lead, index) => ({
  id: `deal-${index + 1}`,
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

export const demoProposals: ProposalDto[] = [{
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
  lead: demoLeads[0]!,
  deal: demoDeals[0]!,
  createdBy: demoUser,
  approvedBy: demoUser,
  sentBy: demoUser,
  currentVersion: proposalVersion,
  approvedVersion: proposalVersion,
  versions: [proposalVersion],
  statusChanges: []
}];

const actionItem = (id: string, title: string, detail: string, leadIndex: number) => ({
  id,
  type: "NEGOTIATION_HANDOFF" as const,
  severity: "WARNING" as const,
  title,
  detail,
  status: "ACTIVE",
  leadId: demoLeads[leadIndex]!.id,
  conversationId: null,
  proposalId: null,
  sourceEntityType: "Lead",
  sourceEntityId: demoLeads[leadIndex]!.id,
  occurredAt: demoLeads[leadIndex]!.lastActivityAt ?? now,
  lead: demoLeads[leadIndex]!
});

export const demoDashboard: SalesActionDashboardDto = {
  generatedAt: now,
  pendingProposalApprovals: [],
  negotiationAndTakeoverAlerts: [
    actionItem("action-1", "Commercial review requested", "BluePeak requested revised pricing terms.", 2),
    actionItem("action-2", "Stakeholder handoff active", "Meridian requires a security stakeholder review.", 1)
  ],
  failuresRequiringAttention: [],
  meetings: {
    status: "AVAILABLE",
    items: [actionItem("meeting-action-1", "Discovery meeting confirmed", "Northstar Labs / Oct 10, 12:00 PM", 0)],
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
demoDashboard.actionItems = [...demoDashboard.negotiationAndTakeoverAlerts, ...demoDashboard.meetings.items];

const agentTypes = ["OUTREACH", "REPLY_UNDERSTANDING", "QUALIFICATION", "PROPOSAL", "MEETING", "VOICE", "WHATSAPP", "SALES_COPILOT"] as const;
export const demoAgents: AgentDashboardDto = {
  agents: agentTypes.map((type, index) => ({
    id: `agent-${type.toLowerCase().replaceAll("_", "-")}`,
    key: type.toLowerCase(),
    name: `${type.split("_").map((word) => word[0] + word.slice(1).toLowerCase()).join(" ")} Agent`,
    description: `Coordinates ${type.toLowerCase().replaceAll("_", " ")} using governed sales context.`,
    type,
    status: index === 5 ? "PAUSED" : "ACTIVE",
    currentVersionId: `agent-version-${index + 1}`,
    createdByUserId: demoUser.id,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: now,
    currentVersion: {
      id: `agent-version-${index + 1}`,
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
    versions: [],
    executionCount: 18 + index * 7,
    successfulExecutionCount: 16 + index * 6,
    failedExecutionCount: 2 + index,
    successRate: Math.round(((16 + index * 6) / (18 + index * 7)) * 1000) / 10,
    lastExecutedAt: `2026-10-08T0${8 - (index % 6)}:15:00.000Z`
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
  if (!agent || !agent.currentVersion) return null;
  return {
    ...agent,
    versions: [agent.currentVersion],
    executions: [0, 1, 2].map((index) => ({
      id: `${id}-execution-${index + 1}`,
      agentId: id,
      versionId: agent.currentVersion!.id,
      source: "SALES_PLATFORM",
      sourceEntityType: "Lead",
      sourceEntityId: demoLeads[index]!.id,
      entityType: "Lead",
      entityId: demoLeads[index]!.id,
      leadId: demoLeads[index]!.id,
      status: index === 2 ? "FAILED" : "SUCCEEDED",
      startedAt: `2026-10-0${8 - index}T09:00:00.000Z`,
      completedAt: `2026-10-0${8 - index}T09:00:0${index + 2}.000Z`,
      durationMs: 1800 + index * 450,
      summary: index === 2 ? "Provider response required a retry." : "Business action completed and recorded.",
      result: { outcome: index === 2 ? "retry_required" : "completed" },
      evaluation: { score: index === 2 ? 62 : 94 - index * 3 },
      correlationId: `${id}-demo-${index + 1}`
    }))
  };
}
