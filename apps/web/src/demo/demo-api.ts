import {
  demoActivities,
  demoAgentDetail,
  demoAgents,
  demoCompanies,
  demoContacts,
  demoConversations,
  demoDashboard,
  demoDeals,
  demoLeads,
  demoMeetings,
  demoPipeline,
  demoProposals,
  demoQualification,
  demoRep,
  demoTasks,
  demoUser
} from "./demo-data.js";

function page<T>(items: T[]): { items: T[]; page: number; pageSize: number; total: number; totalPages: number } {
  return { items, page: 1, pageSize: Math.max(items.length, 10), total: items.length, totalPages: 1 };
}

function leadScoped<T extends { leadId?: string | null }>(items: T[], leadId: string | null): T[] {
  return leadId ? items.filter((item) => item.leadId === leadId) : items;
}

export function demoApiResponse(path: string): unknown {
  const url = new URL(path, "https://preview.shilabs.demo");
  const route = url.pathname;
  const leadId = url.searchParams.get("leadId");

  if (route === "/api/action-dashboard") return demoDashboard;
  if (route === "/api/operations/dashboard") {
    return {
      generatedAt: "2026-10-08T08:30:00.000Z",
      providerHealth: [
        { key: "crm", label: "CRM Sync", provider: "ZOHO_BIGIN", status: "CONFIGURED", configured: true, checkedAt: "2026-10-08T08:30:00.000Z", missingConfig: [], lastError: null, evidence: "DEMO_PREVIEW" },
        { key: "ai", label: "AI Provider", provider: "AI", status: "CONFIGURED", configured: true, checkedAt: "2026-10-08T08:30:00.000Z", missingConfig: [], lastError: null, evidence: "DEMO_PREVIEW" },
        { key: "calendar", label: "Calendar", provider: "GOOGLE_CALENDAR", status: "CONFIGURED", configured: true, checkedAt: "2026-10-08T08:30:00.000Z", missingConfig: [], lastError: null, evidence: "DEMO_PREVIEW" }
      ],
      work: { statusCounts: [{ status: "QUEUED", count: 2 }, { status: "COMPLETED", count: 46 }], queuedCount: 2, failedCount: 0, attentionRequiredCount: 0, recentProblemItems: [] },
      unsyncedRecords: { total: 0, byStatus: [] },
      providerErrors: [],
      usage: [
        { key: "email", label: "Emails sent", provider: "EMAIL", count: 184, unit: "messages", period: "ALL_TIME", costAmount: null, currency: null, costUnavailableReason: "Billing data is hidden in preview." },
        { key: "ai", label: "AI executions", provider: "AI", count: 340, unit: "executions", period: "ALL_TIME", costAmount: null, currency: null, costUnavailableReason: "Billing data is hidden in preview." }
      ]
    };
  }
  if (route === "/api/users") return [demoUser, demoRep];
  if (route === "/api/companies") return demoCompanies;
  if (route === "/api/contacts") return demoContacts;
  if (route === "/api/pipeline/stages") return demoPipeline.stages;
  if (route === "/api/pipeline") return [demoPipeline];
  if (route === "/api/agents") return demoAgents;
  if (route.startsWith("/api/agents/")) return demoAgentDetail(route.split("/").at(-1) ?? "");

  if (route === "/api/deals") {
    const stageId = url.searchParams.get("stageId");
    const search = url.searchParams.get("search")?.toLowerCase();
    const items = demoDeals.filter((deal) =>
      (!stageId || deal.stageId === stageId) &&
      (!search || deal.lead.company.name.toLowerCase().includes(search) || `${deal.lead.contact.firstName} ${deal.lead.contact.lastName}`.toLowerCase().includes(search))
    );
    return page(items);
  }
  if (/^\/api\/deals\/[^/]+$/.test(route)) return demoDeals.find((deal) => deal.id === route.split("/").at(-1)) ?? null;

  if (route === "/api/leads") {
    const status = url.searchParams.get("status");
    const stageId = url.searchParams.get("stageId");
    const search = url.searchParams.get("search")?.toLowerCase();
    const items = demoLeads.filter((lead) =>
      (!status || lead.status === status) &&
      (!stageId || lead.stageId === stageId) &&
      (!search || lead.company.name.toLowerCase().includes(search) || lead.contact.email?.toLowerCase().includes(search))
    );
    return page(items);
  }
  const leadRoute = route.match(/^\/api\/leads\/([^/]+)(?:\/(.+))?$/);
  if (leadRoute) {
    const [, id, child] = leadRoute;
    if (child === "activities") return demoActivities.map((activity) => ({ ...activity, leadId: id! }));
    if (child === "qualification") return { ...demoQualification, leadId: id! };
    return demoLeads.find((lead) => lead.id === id) ?? null;
  }

  if (route === "/api/tasks") return leadScoped(demoTasks, leadId);
  if (route === "/api/conversations") return leadScoped(demoConversations, leadId);
  if (/^\/api\/conversations\/[^/]+\/messages$/.test(route)) {
    return [{ id: "message-1", conversationId: "conversation-1", providerMessageId: "demo-message", direction: "INBOUND", senderType: "PROSPECT", senderUserId: null, body: "The proposal looks aligned. Please confirm the rollout timeline.", deliveryStatus: "READ", sentAt: "2026-10-08T07:45:00.000Z", deliveredAt: "2026-10-08T07:45:00.000Z", readAt: "2026-10-08T07:46:00.000Z", failedAt: null, metadata: {}, createdAt: "2026-10-08T07:45:00.000Z", senderUser: null }];
  }
  if (route === "/api/meetings/requests") return leadScoped(demoMeetings, leadId);
  if (route === "/api/proposals") return leadScoped(demoProposals, leadId);
  if (route.startsWith("/api/followups/leads/")) return [];
  if (route === "/api/briefings") return [];
  if (route === "/api/agent-corrections") return [];
  if (route === "/api/notifications") return [];

  return [];
}

