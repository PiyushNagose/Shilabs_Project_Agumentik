import {
  expect,
  test as base,
  type Locator,
  type Page,
  type Request,
  type TestInfo
} from "@playwright/test";
import type {
  AgentDashboardDto,
  CompanyDto,
  ContactDto,
  FollowUpPolicyDto,
  LeadDto,
  MeetingRequestDto,
  PaginatedResponse,
  ProposalDto,
  WorkflowDashboardDto
} from "@shilabs/shared-types";

interface Session {
  get<T>(path: string): Promise<T>;
}
interface Health {
  pending: Set<Request>;
}

const test = base.extend<{ session: Session; health: Health }>({
  session: [
    async ({ context, request }, use) => {
      const apiUrl = process.env.LIVE_FLOW_API_URL || process.env.VITE_API_BASE_URL;
      expect(
        apiUrl,
        "Set LIVE_FLOW_API_URL or VITE_API_BASE_URL for the persisted API"
      ).toBeTruthy();
      const response = await request.post(`${apiUrl}/api/auth/login`, {
        data: { email: process.env.DEV_ADMIN_EMAIL, password: process.env.DEV_ADMIN_PASSWORD }
      });
      expect(response.ok(), `Admin login returned HTTP ${response.status()}`).toBeTruthy();
      const auth = (await response.json()) as { accessToken: string; user: unknown };
      await context.addInitScript((value) => {
        localStorage.setItem("shilabs.accessToken", value.accessToken);
        localStorage.setItem("shilabs.user", JSON.stringify(value.user));
      }, auth);
      await use({
        async get<T>(path: string): Promise<T> {
          const result = await request.get(`${apiUrl}${path}`, {
            headers: { Authorization: `Bearer ${auth.accessToken}` }
          });
          expect(result.ok(), `${path} returned HTTP ${result.status()}`).toBeTruthy();
          return (await result.json()) as T;
        }
      });
    },
    { auto: true }
  ],
  health: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const pending = new Set<Request>();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => {
        if (new URL(response.url()).pathname.startsWith("/api/") && response.status() >= 500) {
          errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
        }
      });
      page.on("dialog", async (dialog) => {
        errors.push(`Unexpected browser dialog: ${dialog.type()}`);
        await dialog.dismiss();
      });
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (
          path.startsWith("/api/") &&
          !path.startsWith("/api/realtime") &&
          ["fetch", "xhr"].includes(request.resourceType())
        )
          pending.add(request);
      });
      page.on("requestfinished", (request) => pending.delete(request));
      page.on("requestfailed", (request) => pending.delete(request));
      // Read-only browser coverage: an accidental submit cannot reach the live API.
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
          errors.push(
            `Blocked unexpected mutation: ${request.method()} ${new URL(request.url()).pathname}`
          );
          await route.abort("blockedbyclient");
        } else await route.continue();
      });
      await use({ pending });
      expect
        .soft(errors, "No browser exceptions, API 500s, native dialogs, or mutations")
        .toEqual([]);
    },
    { auto: true }
  ]
});

async function settled(page: Page, health: Health): Promise<void> {
  await expect
    .poll(() => health.pending.size, {
      message: "Wait for persisted API requests to finish",
      timeout: 30000
    })
    .toBe(0);
  await expect(
    page
      .locator(".state-block:visible")
      .filter({ hasText: /loading|fetching|preparing|unavailable|could not/i })
  ).toHaveCount(0);
  await expect(
    page.locator(
      ".form-error:visible, .admin-inline-error:visible, .composer-error:visible, .agent-form-error:visible"
    )
  ).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  });
}

async function capture(page: Page, info: TestInfo, name: string): Promise<void> {
  if (info.project.name === "desktop") {
    const sidebar = page.locator(".app-sidebar");
    await expect
      .poll(() =>
        sidebar.evaluate((element) => ({
          width: element.getBoundingClientRect().width,
          expected: parseFloat(getComputedStyle(element).getPropertyValue("--shell-sidebar-width"))
        }))
      )
      .toEqual({ width: 236, expected: 236 });
  }
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth
        ),
      { message: `${name}: no document or body horizontal overflow` }
    )
    .toBeLessThanOrEqual(1);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: "disabled"
  });
}

async function dialogFieldsFit(dialog: Locator): Promise<void> {
  await expect(dialog).toBeVisible();
  const fits = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.left >= -1 &&
      rect.top >= -1 &&
      rect.right <= innerWidth + 1 &&
      rect.bottom <= innerHeight + 1
    );
  });
  expect(fits, "The entire dialog stays within the viewport").toBe(true);
  const fields = dialog.locator(
    'input:not([type="hidden"]):not([type="checkbox"]), textarea, .themed-select-trigger'
  );
  expect(await fields.count(), "The dialog contains real editable fields").toBeGreaterThan(0);
  for (const field of await fields.all()) {
    await field.scrollIntoViewIfNeeded();
    const appearance = await field.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const dialogRect = element.closest('[role="dialog"]')!.getBoundingClientRect();
      const edges = ["Top", "Right", "Bottom", "Left"] as const;
      return {
        label:
          element.getAttribute("aria-label") ||
          element.closest("label")?.textContent?.trim() ||
          element.tagName,
        withinViewport:
          rect.left >= -1 &&
          rect.top >= -1 &&
          rect.right <= innerWidth + 1 &&
          rect.bottom <= innerHeight + 1,
        withinDialog: rect.left >= dialogRect.left - 1 && rect.right <= dialogRect.right + 1,
        borders: edges.map((edge) => ({
          width: parseFloat(style[`border${edge}Width`]),
          style: style[`border${edge}Style`],
          color: style[`border${edge}Color`],
          background: style.backgroundColor
        }))
      };
    });
    expect(
      appearance.withinViewport,
      `${appearance.label}: field stays in the viewport after scrolling`
    ).toBe(true);
    expect(appearance.withinDialog, `${appearance.label}: field fits the dialog width`).toBe(true);
    for (const border of appearance.borders) {
      expect(border.width, `${appearance.label}: visible field border`).toBeGreaterThanOrEqual(1);
      expect(["none", "hidden"]).not.toContain(border.style);
      expect(border.color).not.toMatch(/^(transparent|rgba\([^)]*,\s*0\))$/);
      expect(border.color, `${appearance.label}: border contrasts with its background`).not.toBe(
        border.background
      );
    }
  }
  await dialog.locator(".ui-overlay-body").evaluate((element) => {
    element.scrollTop = 0;
  });
}

const leadTabs = [
  { label: "Overview", heading: "Operational overview" },
  {
    label: "Conversation",
    selector:
      ".simulator-panel .production-outreach-panel, .simulator-panel .conversation-layout, .simulator-panel .conversation-messages, .simulator-panel h3"
  },
  { label: "Qualification", heading: "Qualification signals" },
  {
    label: "Proposals",
    selector:
      ".proposal-review .proposal-empty-state, .proposal-review .proposal-editor, .proposal-review .proposal-editor-head"
  },
  { label: "Sessions", heading: "Latest activity" },
  { label: "Tasks", heading: "Lead work" },
  { label: "Meetings", heading: "Schedule meeting" },
  { label: "Deal", heading: "Pipeline context" },
  { label: "AI Insights", heading: "Grounded Lead Briefing" }
] as const;

test("first persisted lead renders every detail tab and survives reload", async ({
  page,
  session,
  health
}, info) => {
  test.setTimeout(180000);
  const leads = await session.get<PaginatedResponse<LeadDto>>("/api/leads");
  test.skip(
    leads.items.length === 0,
    "No persisted lead exists; create a real lead to verify its detail tabs."
  );
  const lead = leads.items[0]!;
  const proposals = await session.get<ProposalDto[]>(`/api/proposals?leadId=${encodeURIComponent(lead.id)}`);
  const meetings = await session.get<MeetingRequestDto[]>(`/api/meetings/requests?leadId=${encodeURIComponent(lead.id)}`);
  await page.goto(`/crm/leads/${encodeURIComponent(lead.id)}`);
  await expect(page.getByRole("tablist", { name: "Lead sections" })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: `${lead.contact.firstName} ${lead.contact.lastName}`.trim(),
      exact: true
    })
  ).toBeVisible();
  for (const tab of leadTabs)
    await test.step(tab.label, async () => {
      const button = page.getByRole("tab", { name: tab.label, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-selected", "true");
      if ("heading" in tab)
        await expect(page.getByRole("heading", { name: tab.heading, exact: true })).toBeVisible();
      else await expect(page.locator(tab.selector).first()).toBeVisible();
      if (tab.label === "AI Insights")
        await expect(
          page.getByRole("region", { name: "Lead intelligence", exact: true })
        ).toBeVisible();
      await settled(page, health);
      if (tab.label === "Overview") {
        for (const [label, count] of [["Proposal records", proposals.length], ["Meeting requests", meetings.length]] as const) {
          await expect(page.locator(".tab-data-item").filter({ has: page.getByText(label, { exact: true }) }).locator("strong")).toHaveText(String(count));
        }
      }
      await capture(page, info, `lead-${tab.label.toLowerCase().replaceAll(" ", "-")}`);
    });
  await page.reload();
  await expect(page.getByRole("tab", { name: "AI Insights", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(
    page.getByRole("heading", { name: "Grounded Lead Briefing", exact: true })
  ).toBeVisible();
  await settled(page, health);
});

for (const kind of ["agents", "workflows"] as const) {
  test(`first persisted ${kind === "agents" ? "agent" : "workflow"} renders all detail tabs and survives reload`, async ({
    page,
    session,
    health
  }, info) => {
    test.setTimeout(120000);
    const dashboard = await session.get<AgentDashboardDto | WorkflowDashboardDto>(`/api/${kind}`);
    const records = "agents" in dashboard ? dashboard.agents : dashboard.workflows;
    test.skip(records.length === 0, `No persisted ${kind} record exists to inspect.`);
    const record = records[0]!;
    await page.goto(`/${kind}/${encodeURIComponent(record.id)}`);
    await expect(
      page.locator(".agent-detail-title").getByRole("heading", { name: record.name, exact: true })
    ).toBeVisible();
    const navigation = page.getByRole("navigation", {
      name: kind === "agents" ? "Agent detail" : "Workflow detail",
      exact: true
    });
    const tabs =
      kind === "agents"
        ? ["Overview", "Composer", "Executions", "Evaluation", "Versions"]
        : ["Overview", "Builder", "Executions", "Versions"];
    for (const label of tabs)
      await test.step(label, async () => {
        const button = navigation.getByRole("button", { name: new RegExp(`^${label}(?:\\s|$)`) });
        await button.click();
        await expect(button).toHaveClass(/\bactive\b/);
        if (label === "Overview")
          await expect(
            page.getByRole("heading", {
              name: kind === "agents" ? "Capability configuration" : "Definition",
              exact: true
            })
          ).toBeVisible();
        if (label === "Composer" || label === "Builder") {
          await expect(
            page.getByRole("heading", {
              name: kind === "agents" ? "Visual behavior" : "Workflow Builder",
              exact: true
            })
          ).toBeVisible();
          await expect(page.locator(".composer-canvas")).toBeVisible();
        }
        if (label === "Executions")
          await expect(
            page
              .locator(".agent-execution-list, .state-block")
              .filter({ hasText: /No executions yet|Workflow run|Lead|Outcome/i })
              .first()
          ).toBeVisible();
        if (label === "Evaluation")
          await expect(
            page.getByRole("heading", { name: "Run schedule and outcomes", exact: true })
          ).toBeVisible();
        if (label === "Versions") {
          await expect(page.locator(".agent-version-list")).toBeVisible();
          await expect(page.locator(".agent-version-number").first()).toHaveText(/^v\d+$/i);
        }
        await settled(page, health);
        await capture(page, info, `${kind}-${label.toLowerCase()}`);
      });
    await page.reload();
    await expect(navigation.getByRole("button", { name: /^Versions(?:\s|$)/ })).toHaveClass(
      /\bactive\b/
    );
    await expect(page.locator(".agent-version-number").first()).toBeVisible();
    await settled(page, health);
  });
}

test("settings privacy shows saved policy and opens a named erasure dialog without changing data", async ({
  page,
  session,
  health
}, info) => {
  const policy = await session.get<{ enabled: boolean; periods: Record<string, number | null> }>(
    "/api/privacy/policy"
  );
  const contacts = await session.get<ContactDto[]>("/api/contacts");
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Privacy and retention", exact: true });
  await expect(section.getByRole("checkbox", { name: "Allow scheduled cleanup" })).toBeVisible();
  await expect(section.getByRole("checkbox", { name: "Allow scheduled cleanup" })).toBeChecked({
    checked: policy.enabled
  });
  const cleanupSize = await section
    .getByRole("checkbox", { name: "Allow scheduled cleanup" })
    .boundingBox();
  expect(cleanupSize?.width).toBeLessThanOrEqual(20);
  expect(cleanupSize?.height).toBeLessThanOrEqual(20);
  const labels = {
    email: "Email content",
    messages: "Message content",
    calls: "Call transcripts and recording links",
    providerPayloads: "Provider payloads",
    ai: "AI context and results",
    files: "Stored document content",
    audit: "Audit and activity details",
    deletedRecords: "Erased contact details"
  };
  for (const [key, label] of Object.entries(labels))
    await expect(
      section.getByRole("spinbutton", { name: `${label} (days)`, exact: true })
    ).toHaveValue(policy.periods[key] == null ? "" : String(policy.periods[key]));
  await expect(section.getByRole("button", { name: "Export contact", exact: true })).toBeDisabled();
  await expect(section.getByRole("button", { name: "Erase contact", exact: true })).toBeDisabled();
  await settled(page, health);
  await capture(page, info, "settings-privacy");
  if (contacts.length === 0) {
    await expect(section).toContainText("No contacts are available in this workspace.");
    return;
  }
  const contact = contacts[0]!;
  const name = `${contact.firstName} ${contact.lastName}`;
  const label = `${name}${contact.email ? ` (${contact.email})` : ""}`;
  await section.locator(".themed-select-trigger").click();
  await page
    .getByRole("listbox", { name: "Contact", exact: true })
    .getByRole("option", { name: label, exact: true })
    .click();
  await section.getByRole("button", { name: "Erase contact", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Erase contact data", exact: true });
  await expect(dialog).toContainText(name);
  await expect(dialog.getByRole("button", { name: "Erase contact", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("textbox")).toBeEmpty();
  await dialogFieldsFit(dialog);
  await settled(page, health);
  await capture(page, info, "privacy-erasure-dialog");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await session.get("/api/privacy/policy")).toEqual(policy);
});

test("settings company communication draft uses persisted options and fits without saving", async ({
  page,
  session,
  health
}, info) => {
  const companies = await session.get<CompanyDto[]>("/api/companies");
  const policies = await session.get<FollowUpPolicyDto[]>("/api/followups/policies");
  expect(
    companies.length,
    "A persisted company is required to verify company targeting"
  ).toBeGreaterThan(0);
  const company = [...companies].sort((left, right) => right.name.length - left.name.length)[0];
  if (!company) throw new Error("No persisted company is available");
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Automatic follow-up schedules", exact: true })
  ).toBeVisible();
  await settled(page, health);
  await page.getByRole("button", { name: "New schedule", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New follow-up schedule", exact: true });
  const companySelect = dialog.locator('select[aria-label="Company"]');
  await expect(companySelect.locator("option")).toHaveCount(companies.length + 1);
  expect(
    await companySelect.locator("option").evaluateAll((options) =>
      options.map((option) => ({
        value: (option as HTMLOptionElement).value,
        label: option.textContent
      }))
    )
  ).toEqual([
    { value: "", label: "Any company" },
    ...companies.map((item) => ({ value: item.id, label: item.name }))
  ]);
  await expect(
    dialog.getByRole("textbox", { name: "Communication personality", exact: true })
  ).toBeEmpty();
  await expect(dialog.getByRole("textbox", { name: "Follow-up days", exact: true })).toHaveValue(
    "1, 5, 9"
  );
  const companyTrigger = companySelect.locator("..").locator(".themed-select-trigger");
  await companyTrigger.click();
  const options = dialog.getByRole("listbox", { name: "Company", exact: true });
  await expect(options.getByRole("option")).toHaveText([
    "Any company",
    ...companies.map((item) => item.name)
  ]);
  await options
    .getByRole("option")
    .nth(companies.findIndex((item) => item.id === company.id) + 1)
    .click();
  await expect(companySelect).toHaveValue(company.id);
  await expect(companyTrigger).toHaveText(company.name);
  await dialog
    .getByRole("textbox", { name: "Schedule name", exact: true })
    .fill("Unsaved company communication draft");
  await dialog
    .getByRole("textbox", { name: "Communication personality", exact: true })
    .fill("Warm and concise. Address the customer's questions before suggesting a next step.");
  await dialog.getByRole("textbox", { name: "Follow-up days", exact: true }).fill("3, 8, 14");
  await dialogFieldsFit(dialog);
  await settled(page, health);
  await expect(
    dialog.locator(".ui-overlay-footer").getByRole("button", { name: "Save schedule", exact: true })
  ).toBeInViewport();
  expect(
    await dialog
      .getByRole("textbox", { name: "Communication personality", exact: true })
      .evaluate((element) => parseFloat(getComputedStyle(element).borderRadius))
  ).toBe(8);
  await capture(page, info, "settings-company-communication-draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "New schedule", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Schedule name", exact: true })).toBeEmpty();
  await expect(companySelect).toHaveValue("");
  await expect(
    dialog.getByRole("textbox", { name: "Communication personality", exact: true })
  ).toBeEmpty();
  await expect(dialog.getByRole("textbox", { name: "Follow-up days", exact: true })).toHaveValue(
    "1, 5, 9"
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await session.get("/api/followups/policies")).toEqual(policies);
  expect(await session.get("/api/companies")).toEqual(companies);
});

test("settings saved communication schedule opens persisted values without changing records", async ({
  page,
  session,
  health
}, info) => {
  const policies = await session.get<FollowUpPolicyDto[]>("/api/followups/policies");
  test.skip(
    policies.length === 0,
    "No persisted follow-up schedule exists to inspect; this test never creates one."
  );
  const policy =
    policies.find((item) => item.companyId && item.communicationPersonality) ?? policies[0];
  if (!policy) throw new Error("No persisted follow-up schedule is available");
  const companies = await session.get<CompanyDto[]>("/api/companies");
  await page.goto("/settings");
  await settled(page, health);
  await page
    .locator(".follow-up-policy-row")
    .nth(policies.findIndex((item) => item.id === policy.id))
    .getByRole("button", { name: `Edit ${policy.name}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit follow-up schedule", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Schedule name", exact: true })).toHaveValue(
    policy.name
  );
  await expect(dialog.getByRole("textbox", { name: "Follow-up days", exact: true })).toHaveValue(
    policy.cadenceDays.filter((day) => day > 0).join(", ")
  );
  await expect(
    dialog.getByRole("textbox", { name: "Communication personality", exact: true })
  ).toHaveValue(policy.communicationPersonality ?? "");
  const companySelect = dialog.locator('select[aria-label="Company"]');
  await expect(companySelect).toHaveValue(policy.companyId ?? "");
  const companyLabel = policy.companyId
    ? (companies.find((item) => item.id === policy.companyId)?.name ?? policy.companyId)
    : "Any company";
  await expect(companySelect.locator("..").locator(".themed-select-trigger")).toHaveText(
    companyLabel
  );
  await expect(
    dialog.getByRole("spinbutton", { name: "Selection priority", exact: true })
  ).toHaveValue(String(policy.selectionPriority));
  await expect(dialog.getByRole("checkbox", { name: "Active", exact: true })).toBeChecked({
    checked: policy.enabled
  });
  await expect(
    dialog.getByRole("checkbox", { name: "Use as the default schedule", exact: true })
  ).toBeChecked({ checked: policy.isDefault });
  await dialogFieldsFit(dialog);
  await settled(page, health);
  await capture(page, info, "settings-saved-communication-schedule");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await session.get("/api/followups/policies")).toEqual(policies);
});

test("users add-member modal has visible field borders and fits the viewport without saving", async ({
  page,
  health
}, info) => {
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await settled(page, health);
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add team member", exact: true });
  for (const label of ["First name", "Last name", "Work email", "Temporary password"])
    await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
  await expect(dialog.locator(".themed-select-trigger")).toBeVisible();
  await dialogFieldsFit(dialog);
  await settled(page, health);
  await capture(page, info, "users-add-member-dialog");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
