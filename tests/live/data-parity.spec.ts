import { expect, test } from "@playwright/test";
import type {
  AgentDashboardDto,
  AiCommandCenterDto,
  CompanyDto,
  ContactDto,
  DealDto,
  IntegrationDashboardDto,
  LeadDto,
  OrderDto,
  PaginatedResponse,
  PublicUser,
  SalesActionDashboardDto,
  WorkflowDashboardDto,
  ManagerAccountabilityReportDto
} from "@shilabs/shared-types";

test.beforeEach(async ({ context, request }) => {
  const base = process.env.LIVE_FLOW_API_URL || process.env.VITE_API_BASE_URL;
  const response = await request.post(`${base}/api/auth/login`, {
    data: { email: process.env.DEV_ADMIN_EMAIL, password: process.env.DEV_ADMIN_PASSWORD }
  });
  expect(response.ok()).toBeTruthy();
  const auth = (await response.json()) as { accessToken: string; user: unknown };
  await context.addInitScript((value) => {
    localStorage.setItem("shilabs.accessToken", value.accessToken);
    localStorage.setItem("shilabs.user", JSON.stringify(value.user));
  }, auth);
});

test("dashboard CRM totals match the actual visible records, separately from pending work", async ({
  page,
  request
}, info) => {
  await page.goto("/dashboard");
  const token = await page.evaluate(() => localStorage.getItem("shilabs.accessToken"));
  const base = process.env.LIVE_FLOW_API_URL || process.env.VITE_API_BASE_URL;
  async function get<T>(path: string): Promise<T> {
    const response = await request.get(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.ok(), path).toBeTruthy();
    return (await response.json()) as T;
  }
  const leads = await get<PaginatedResponse<LeadDto>>("/api/leads");
  const contacts = await get<ContactDto[]>("/api/contacts");
  const companies = await get<CompanyDto[]>("/api/companies");
  const deals = await get<PaginatedResponse<DealDto>>("/api/deals?status=OPEN");
  const dashboard = await get<SalesActionDashboardDto>("/api/action-dashboard");
  expect(dashboard.overview).toEqual({
    leads: leads.total,
    contacts: contacts.length,
    companies: companies.length,
    openDeals: deals.total
  });
  async function verify(): Promise<void> {
    const overview = page.getByRole("region", { name: "CRM overview", exact: true });
    for (const [label, count] of [
      ["Leads", leads.total],
      ["Contacts", contacts.length],
      ["Companies", companies.length],
      ["Open deals", deals.total]
    ] as const) {
      await expect(
        overview
          .locator("span")
          .filter({ has: page.getByText(label, { exact: true }) })
          .locator("strong")
      ).toHaveText(String(count));
    }
    const actions = page.getByRole("region", { name: "Work needing attention" });
    for (const [label, count] of [
      ["Proposal approvals", dashboard.summary.pendingProposalApprovals],
      ["Handoff alerts", dashboard.summary.negotiationAndTakeoverAlerts],
      ["Failures", dashboard.summary.failuresRequiringAttention],
      ["Meeting actions", dashboard.summary.meetings]
    ] as const) {
      await expect(
        actions
          .locator("span")
          .filter({ has: page.getByText(label, { exact: true }) })
          .locator("strong")
      ).toHaveText(String(count));
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
  }
  await verify();
  await page.reload();
  await verify();
  await page.screenshot({ path: info.outputPath("dashboard-data-verified.png"), fullPage: true });
});

for (const target of [
  { route: "/contacts", endpoint: "/api/contacts", noun: "records" },
  { route: "/companies", endpoint: "/api/companies", noun: "accounts" },
  { route: "/deals", endpoint: "/api/deals", noun: "records" }
]) {
  test(`${target.route} shows its persisted record count and identity`, async ({
    page,
    request
  }) => {
    await page.goto(target.route);
    const token = await page.evaluate(() => localStorage.getItem("shilabs.accessToken"));
    const base = process.env.LIVE_FLOW_API_URL || process.env.VITE_API_BASE_URL;
    const response = await request.get(`${base}${target.endpoint}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.ok()).toBeTruthy();
    const data = (await response.json()) as
      CompanyDto[] | ContactDto[] | PaginatedResponse<DealDto>;
    const items = Array.isArray(data) ? data : data.items;
    const count = Array.isArray(data) ? data.length : data.total;
    await expect(
      page.getByText(`${count} authorized ${target.noun}`, { exact: true })
    ).toBeVisible();
    const first = items[0];
    if (first) {
      const name =
        "lead" in first
          ? `${first.lead.contact.firstName} ${first.lead.contact.lastName}`
          : "firstName" in first
            ? `${first.firstName} ${first.lastName}`
            : first.name;
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }
  });
}

for (const kind of ["agents", "workflows", "integrations", "users"] as const) {
  test(`${kind} summary uses the persisted API counts`, async ({ page, request }) => {
    await page.goto(`/${kind}`);
    const token = await page.evaluate(() => localStorage.getItem("shilabs.accessToken"));
    const base = process.env.LIVE_FLOW_API_URL || process.env.VITE_API_BASE_URL;
    const response = await request.get(`${base}/api/${kind}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.ok()).toBeTruthy();
    const payload: unknown = await response.json();
    let metrics: [string, number][];
    if (kind === "agents") {
      const { summary } = payload as AgentDashboardDto;
      metrics = [
        ["Total agents", summary.totalAgents],
        ["Active", summary.activeAgents],
        ["Executions", summary.totalExecutions]
      ];
    } else if (kind === "workflows") {
      const { summary } = payload as WorkflowDashboardDto;
      metrics = [
        ["Total workflows", summary.total],
        ["Published", summary.published],
        ["Executions", summary.executions],
        ["Running / waiting", summary.running]
      ];
    } else if (kind === "integrations") {
      const { summary } = payload as IntegrationDashboardDto;
      metrics = [
        ["Total", summary.total],
        ["Connected", summary.connected],
        ["Needs attention", summary.needsAttention],
        ["Failed", summary.failed]
      ];
    } else {
      const users = payload as PublicUser[];
      metrics = [
        ["Team members", users.length],
        ["Active", users.filter((user) => user.status === "ACTIVE").length]
      ];
    }
    const region = page.locator(
      kind === "integrations"
        ? ".integration-kpis"
        : kind === "users"
          ? ".admin-summary"
          : ".agent-kpis"
    );
    for (const [label, count] of metrics) {
      await expect(
        region
          .locator(".ui-card")
          .filter({ has: page.getByText(label, { exact: true }) })
          .locator("strong")
      ).toHaveText(String(count));
    }
  });
}

test("an empty orders list is genuinely empty in the API", async ({ page, request }) => {
  await page.goto("/orders");
  const token = await page.evaluate(() => localStorage.getItem("shilabs.accessToken"));
  const base = process.env.LIVE_FLOW_API_URL || process.env.VITE_API_BASE_URL;
  const response = await request.get(`${base}/api/orders`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(response.ok()).toBeTruthy();
  const data = (await response.json()) as PaginatedResponse<OrderDto>;
  if (data.total === 0)
    await expect(
      page.getByRole("status").getByText("No orders found", { exact: true })
    ).toBeVisible();
  else
    await expect(page.getByText(data.items[0]!.orderNumber, { exact: true }).first()).toBeVisible();
});

test("command center activity totals match its API", async ({ page, request }) => {
  await page.goto("/ai-command-center");
  const token = await page.evaluate(() => localStorage.getItem("shilabs.accessToken"));
  const base = process.env.LIVE_FLOW_API_URL || process.env.VITE_API_BASE_URL;
  const response = await request.get(`${base}/api/lead-intelligence/command-center`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(response.ok()).toBeTruthy();
  const { metrics } = (await response.json()) as AiCommandCenterDto;
  const region = page.getByRole("region", { name: "Manager metrics" });
  for (const [label, value] of [
    ["Active leads", metrics.activeLeads],
    ["Human required", metrics.humanRequired],
    ["AI active", metrics.aiActive],
    ["Overdue actions", metrics.overdueHumanActions],
    ["Meetings today", metrics.meetingsToday]
  ] as const) {
    await expect(
      region
        .locator(".ui-card")
        .filter({ has: page.getByText(label, { exact: true }) })
        .locator("strong")
    ).toHaveText(String(value));
  }
});

test("report counts match recorded activity rather than substituting overall lead counts", async ({
  page,
  request
}) => {
  await page.goto("/reports");
  const token = await page.evaluate(() => localStorage.getItem("shilabs.accessToken"));
  const base = process.env.LIVE_FLOW_API_URL || process.env.VITE_API_BASE_URL;
  const response = await request.get(`${base}/api/analytics/accountability`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(response.ok()).toBeTruthy();
  const report = (await response.json()) as ManagerAccountabilityReportDto;
  const region = page.getByRole("region", { name: "Human performance", exact: true });
  for (const [label, value] of [
    ["Leads handled", report.humanKpis.leadsHandled],
    ["Sales opportunities", report.humanKpis.opportunities],
    ["Meetings booked", report.humanKpis.meetingsBooked],
    ["Proposals sent", report.humanKpis.proposalsSent]
  ] as const) {
    await expect(
      region
        .locator(".accountability-metric")
        .filter({ has: page.getByText(label, { exact: true }) })
        .locator("strong")
    ).toHaveText(String(value));
  }
});

test("company pipeline values match open deals rather than lead estimates", async ({
  page,
  request
}) => {
  await page.goto("/companies");
  const token = await page.evaluate(() => localStorage.getItem("shilabs.accessToken"));
  const base = process.env.LIVE_FLOW_API_URL || process.env.VITE_API_BASE_URL;
  async function get<T>(path: string): Promise<T> {
    const response = await request.get(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()) as T;
  }
  const companies = await get<CompanyDto[]>("/api/companies");
  const first = await get<PaginatedResponse<DealDto>>("/api/deals?status=OPEN&page=1&pageSize=100");
  const deals = [...first.items];
  for (let page = 2; page <= first.totalPages; page += 1) {
    deals.push(
      ...(await get<PaginatedResponse<DealDto>>(`/api/deals?status=OPEN&page=${page}&pageSize=100`))
        .items
    );
  }
  for (const company of companies) {
    const open = deals.filter((deal) => deal.lead.companyId === company.id);
    const expected = await page.evaluate((records) => {
      if (records.length === 0) return "No open deals";
      const totals = new Map<string, number>();
      for (const record of records)
        if (record.value !== null)
          totals.set(record.currency, (totals.get(record.currency) ?? 0) + Number(record.value));
      if (totals.size === 0) return "Value not set";
      return [...totals]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, value]) =>
          new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
            maximumFractionDigits: 2
          }).format(value)
        )
        .join(", ");
    }, open);
    const card = page
      .locator(".company-card")
      .filter({ has: page.getByRole("heading", { name: company.name, exact: true }) });
    await expect(
      card
        .locator(".company-facts > div")
        .filter({ has: page.getByText("Open pipeline", { exact: true }) })
        .locator("dd")
    ).toHaveText(expected);
  }
});
