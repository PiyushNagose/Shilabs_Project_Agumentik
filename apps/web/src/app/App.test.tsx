/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
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

const humanConversation = {
  ...conversation,
  mode: "HUMAN"
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
  title: "Negotiation handoff required",
  body: "Prospect is negotiating price and needs the assigned owner to respond.",
  assignedToUserId: adminUser.id,
  leadId: lead.id,
  conversationId: conversation.id,
  negotiationHandoffId: "handoff_1",
  sourceEntityType: "NegotiationHandoff",
  sourceEntityId: "handoff_1",
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

  if (url.endsWith("/api/action-dashboard")) {
    return Promise.resolve(jsonResponse(actionDashboard));
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

  if (url.includes("/api/conversations?")) {
    return Promise.resolve(jsonResponse([conversation]));
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

describe("web app", () => {
  beforeEach(() => {
    window.localStorage.clear();
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

  it("clears authenticated state on logout", async () => {
    window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
    window.localStorage.setItem(
      "shilabs.user",
      JSON.stringify({
        id: "user_1",
        email: "rep@example.local",
        firstName: "Sales",
        lastName: "Rep",
        role: "SALES_REP",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    );
    vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/auth/logout")) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(leadPage()));
    });

    render(<App />);

    expect(screen.getByText("Dashboard")).toBeTruthy();
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

  it("saves simulated inbound prospect messages from the conversation tab", async () => {
    window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
    window.localStorage.setItem("shilabs.user", JSON.stringify(adminUser));
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input, init) => {
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
});
