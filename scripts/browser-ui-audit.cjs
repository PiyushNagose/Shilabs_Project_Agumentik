/* Read-only browser audit using the web suite's isolated response fixtures. */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const demoMode = process.env.UI_AUDIT_DEMO === "true";
const buildersOnly = process.env.UI_AUDIT_BUILDERS_ONLY === "true";
const requestedRoutes = process.env.UI_AUDIT_ROUTES?.split(",").filter(Boolean) ?? [];
const baseUrl = process.env.UI_AUDIT_BASE_URL || "http://localhost:5174";

async function main() {
  const source = fs.readFileSync("apps/web/src/app/App.test.tsx", "utf8");
  const fixtures = source.slice(
    source.indexOf("const adminUser"),
    source.indexOf("function mockCrmFetch")
  );
  const compiled = ts.transpile(fixtures, { target: ts.ScriptTarget.ES2022 });
  const data = new Function(
    compiled +
      ";return { adminUser, crmFetch, generatedProposal, currentMeetingRequest, followUpSequence };"
  )();
  const output = path.join(os.tmpdir(), "shilabs-ui-audit", "screenshots");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const results = [];
  async function waitForRealtime(page, errors, requests) {
    try {
      await page.waitForFunction(() => typeof window.auditSocket?.onmessage === "function", null, {
        timeout: 5000
      });
    } catch {
      const state = await page.evaluate(() => ({
        body: document.body.innerText,
        token: localStorage.getItem("shilabs.accessToken")
      }));
      throw new Error(
        `Realtime audit setup failed. Browser errors: ${errors.join(" | ")}; requests: ${requests.join(", ")}; token: ${Boolean(state.token)}; body: ${state.body.slice(0, 300)}`
      );
    }
  }
  try {
    for (const width of [1440, 768, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      const errors = [];
      const requests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((user) => {
        localStorage.setItem("shilabs.accessToken", "header.payload.signature");
        localStorage.setItem("shilabs.user", JSON.stringify(user));
        window.WebSocket = class {
          constructor() {
            window.auditSocket = this;
            setTimeout(() => this.onopen?.(), 0);
          }
          close() {
            this.onclose?.();
          }
        };
      }, data.adminUser);
      if (!demoMode) {
        await page.route("**/api/**", async (route) => {
          const request = route.request();
          const requestPath = new URL(request.url()).pathname;
          if (!requestPath.startsWith("/api/")) {
            await route.continue();
            return;
          }
          requests.push(requestPath);
          if (request.method() !== "GET")
            throw new Error("Audit attempted a mutation: " + request.url());
          const url = request.url();
          let body;
          if (url.includes("/api/proposals?")) body = [data.generatedProposal];
          else if (url.includes("/api/meetings/requests?")) body = [data.currentMeetingRequest];
          else if (url.includes("/api/followups/leads/")) body = [data.followUpSequence];
          else body = await (await data.crmFetch(url)).json();
          await route.fulfill({ json: body });
        });
      }
      const leadId = demoMode ? "lead-1" : "lead_1";
      const routes = demoMode
        ? [
            "/dashboard",
            "/crm",
            "/contacts",
            "/contacts?audit=drawer",
            "/companies",
            "/deals",
            "/deals?audit=board",
            "/deals?audit=modal",
            "/deals/deal-1",
            "/agents",
            "/agents/agent-outreach?tab=composer",
            "/agents/agent-outreach?tab=executions",
            "/agents/agent-outreach?tab=evaluation",
            "/workflows",
            "/workflows/workflow-governed-follow-up?tab=builder",
            "/integrations",
            "/ai-command-center",
            "/orders",
            "/orders/order-1",
            "/operations",
            "/users",
            "/settings",
            ...[
              "Overview",
              "Conversation",
              "Qualification",
              "Proposals",
              "Activities",
              "Tasks",
              "Meetings",
              "Deal",
              "AI Insights"
            ].map((tab) => `/crm/leads/${leadId}?tab=${encodeURIComponent(tab)}`)
          ]
        : [
            "/dashboard",
            "/operations",
            ...[
              "Overview",
              "Conversation",
              "Qualification",
              "Proposals",
              "Activities",
              "Meetings",
              "Deal",
              "AI Insights"
            ].map((tab) => `/crm/leads/${leadId}?tab=${encodeURIComponent(tab)}`),
            "/users",
            "/settings"
          ];
      const auditedRoutes = requestedRoutes.length
        ? requestedRoutes
        : buildersOnly
          ? [
              "/agents/agent-outreach?tab=composer",
              "/agents/agent-outreach?tab=executions",
              "/agents/agent-outreach?tab=evaluation",
              "/workflows/workflow-governed-follow-up?tab=builder",
              "/integrations"
            ]
          : routes;
      for (const route of auditedRoutes) {
        errors.length = 0;
        await page.goto(baseUrl + route);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(250);
        if (route.includes("audit=board")) {
          await page.getByRole("button", { name: "Pipeline view" }).click();
          await page.waitForTimeout(150);
        }
        if (route.includes("audit=board-scroll")) {
          const board = page.locator(".deal-board");
          const emptyColumnBody = page.locator(".deal-column > div:not(:has(article))").first();
          const before = await board.evaluate((element) => element.scrollLeft);
          await emptyColumnBody.hover();
          await page.mouse.wheel(480, 0);
          await page.waitForTimeout(150);
          const after = await board.evaluate((element) => element.scrollLeft);
          if (after <= before) errors.push("Pipeline board did not scroll over empty column space");
        }
        if (route.includes("audit=drawer")) {
          await page
            .getByRole("button", { name: /^Preview / })
            .first()
            .click();
          await page.waitForTimeout(150);
        }
        if (route.startsWith("/companies") && route.includes("audit=list")) {
          await page.getByRole("button", { name: "List view" }).click();
          await page.waitForTimeout(150);
        }
        if (route.includes("audit=profile-menu")) {
          if (width <= 760) await page.getByRole("button", { name: "Open navigation" }).click();
          await page.getByRole("button", { name: "Open account menu" }).click();
          await page.waitForTimeout(150);
        }
        if (route.startsWith("/deals") && route.includes("audit=modal")) {
          await page.getByRole("button", { name: "New deal", exact: true }).first().click();
          await page.waitForTimeout(150);
        }
        if (route.startsWith("/deals") && route.includes("audit=modal-select")) {
          await page.getByRole("button", { name: "Select a lead" }).click();
          await page.waitForTimeout(150);
        }
        if (route.startsWith("/agents") && route.includes("audit=modal")) {
          await page.getByRole("button", { name: "New agent", exact: true }).click();
          await page.waitForTimeout(150);
        }
        if (route.startsWith("/agents") && route.includes("audit=modal-select")) {
          await page.getByRole("button", { name: "Outreach", exact: true }).click();
          await page.waitForTimeout(150);
        }
        const name = route.replace(/[^a-zA-Z0-9]+/g, "-");
        await page.screenshot({ path: path.join(output, `${width}${name}.png`), fullPage: true });
        const overflow = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth > innerWidth + 1,
          controls: [...document.querySelectorAll("button, .status-badge, input, textarea")]
            .filter((el) => {
              const scrollContainer = el.parentElement?.closest(
                ".agent-directory, .deal-board, .order-table-wrap"
              );
              return (
                el.getBoundingClientRect().width > 0 &&
                el.scrollWidth > el.clientWidth + 2 &&
                el.tagName !== "TEXTAREA" &&
                el.tagName !== "INPUT" &&
                !(scrollContainer && scrollContainer.scrollWidth > scrollContainer.clientWidth + 1)
              );
            })
            .map((el) => el.textContent.trim().slice(0, 100))
        }));
        const typographyOutliers = await page.evaluate(() => {
          const productScale = new Set([
            "11px",
            "12px",
            "13px",
            "14px",
            "16px",
            "20px",
            "24px",
            "26px",
            "32px"
          ]);
          return [...document.querySelectorAll("body *")]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                element.children.length === 0 &&
                element.textContent?.trim() &&
                !["SCRIPT", "STYLE", "OPTION"].includes(element.tagName)
              );
            })
            .map((element) => ({
              size: getComputedStyle(element).fontSize,
              text: element.textContent.trim().slice(0, 50)
            }))
            .filter(({ size }) => !productScale.has(size))
            .slice(0, 8);
        });
        if (typographyOutliers.length) {
          errors.push(
            `Typography outside product scale: ${typographyOutliers
              .map(({ size, text }) => `${size} (${text})`)
              .join(", ")}`
          );
        }
        const tableAlignmentErrors = await page.evaluate(() => {
          const tables = [
            ["Leads", ".lead-row-head", ".lead-row:not(.lead-row-head)"],
            ["Deals", ".deal-table-row.head", "button.deal-table-row:not(.head)"],
            ["Agents", ".agent-table-head", "button.agent-table-row:not(.agent-table-head)"],
            [
              "Workflows",
              ".workflow-table-head",
              "button.workflow-table-row:not(.workflow-table-head)"
            ],
            ["Orders", ".order-table-row.head", ".order-table-row:not(.head)"],
            [
              "Command Center",
              ".command-center-row-head",
              ".command-center-row:not(.command-center-row-head)"
            ]
          ];
          return tables.flatMap(([name, headSelector, rowSelector]) => {
            const head = document.querySelector(headSelector);
            const row = document.querySelector(rowSelector);
            if (!head || !row || head.children.length !== row.children.length) return [];
            const headRect = head.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            if (headRect.width === 0 || headRect.height === 0) return [];
            return [...head.children].flatMap((cell, index) => {
              const headCell = cell.getBoundingClientRect();
              const rowCell = row.children[index].getBoundingClientRect();
              const actionColumn =
                index === head.children.length - 1 && ["Orders", "Command Center"].includes(name);
              const alignmentDelta = actionColumn
                ? Math.abs(
                    headCell.left +
                      headCell.width / 2 -
                      headRect.left -
                      (rowCell.left + rowCell.width / 2 - rowRect.left)
                  )
                : Math.abs(headCell.left - headRect.left - (rowCell.left - rowRect.left));
              return alignmentDelta > 1.5
                ? [`${name} column ${index + 1} drifted by ${alignmentDelta.toFixed(1)}px`]
                : [];
            });
          });
        });
        errors.push(...tableAlignmentErrors);
        if (route.startsWith("/companies") && route.includes("audit=list")) {
          const clippedCompanyActions = await page.evaluate(() =>
            [...document.querySelectorAll(".company-collection.list .company-card > footer")]
              .filter((footer) =>
                [...footer.querySelectorAll(".contact-quick-actions a, .ui-button")].some(
                  (control) => {
                    const item = control.getBoundingClientRect();
                    const container = footer.getBoundingClientRect();
                    return (
                      item.width < 31 ||
                      item.left < container.left - 1 ||
                      item.right > container.right + 1
                    );
                  }
                )
              )
              .map((footer) => footer.closest(".company-card")?.querySelector("h3")?.textContent)
          );
          if (clippedCompanyActions.length)
            errors.push(`Clipped company actions: ${clippedCompanyActions.join(", ")}`);
        }
        if (route.includes("audit=profile-menu")) {
          const hiddenMenuItems = await page.evaluate(() =>
            [...document.querySelectorAll('.profile-popup [role="menuitem"]')]
              .filter((item) => {
                const rect = item.getBoundingClientRect();
                const center = document.elementFromPoint(
                  rect.left + rect.width / 2,
                  rect.top + rect.height / 2
                );
                return (
                  rect.width < 120 ||
                  rect.height < 36 ||
                  rect.left < 0 ||
                  rect.right > innerWidth ||
                  rect.top < 0 ||
                  rect.bottom > innerHeight ||
                  !center ||
                  !item.contains(center)
                );
              })
              .map((item) => item.textContent?.trim())
          );
          if (hiddenMenuItems.length)
            errors.push(`Account menu items are clipped: ${hiddenMenuItems.join(", ")}`);
        }
        if (width > 760) {
          const collapseVisible = await page.evaluate(() => {
            const control = document.querySelector(".sidebar-collapse");
            if (!control) return false;
            const rect = control.getBoundingClientRect();
            const style = getComputedStyle(control);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width >= 36 &&
              rect.height >= 36 &&
              rect.top >= 0 &&
              rect.bottom <= innerHeight + 1
            );
          });
          if (!collapseVisible) errors.push("Sidebar collapse control is not fully visible");
        }
        if (
          demoMode &&
          !["/users", "/settings"].includes(route) &&
          (await page.locator(".access-summary").count()) > 0
        ) {
          errors.push("Implemented workspace renders a duplicate shell heading");
        }
        if (route.includes("audit=board")) {
          const draggableDeals = await page
            .locator('.deal-column article[draggable="true"]')
            .count();
          if (draggableDeals === 0) errors.push("Pipeline board has no draggable deal cards");
        }
        if (route.includes("tab=composer")) {
          const draggableNodes = await page.locator('.composer-node[draggable="true"]').count();
          if (draggableNodes === 0) errors.push("Agent Composer has no draggable nodes");
        }
        if (route.includes("tab=builder")) {
          const draggableNodes = await page.locator('.composer-node[draggable="true"]').count();
          if (draggableNodes === 0) errors.push("Workflow Builder has no draggable nodes");
        }
        if (route === "/ai-command-center") {
          const commandCenterLayout = await page.evaluate(() => {
            const badge = document.querySelector(".command-center-recommendation-cell .ui-badge");
            const recommendation = badge?.parentElement;
            const signal = document.querySelector(".command-center-signal-card");
            const signalLabel = signal?.firstElementChild;
            if (!badge || !recommendation || !signal || !signalLabel) return null;
            const badgeRect = badge.getBoundingClientRect();
            const recommendationRect = recommendation.getBoundingClientRect();
            const signalRect = signal.getBoundingClientRect();
            const labelRect = signalLabel.getBoundingClientRect();
            return {
              badgeIsCompact: badgeRect.width < recommendationRect.width * 0.6,
              signalInset:
                labelRect.left - signalRect.left >= 14 && labelRect.top - signalRect.top >= 12
            };
          });
          if (!commandCenterLayout?.badgeIsCompact)
            errors.push("Command Center recommendation badge is stretched");
          if (!commandCenterLayout?.signalInset)
            errors.push("Command Center signal card content lacks an inner inset");
        }
        if (!route.includes("audit=") && !route.includes("/crm/leads/")) {
          const wheelProbe = await page.evaluate(() => {
            if (document.documentElement.scrollHeight <= innerHeight + 1) return null;
            window.scrollTo(0, 0);
            const candidate = [
              ...document.querySelectorAll(
                ".agent-directory, .deal-table, .deal-board, .order-table-wrap, .command-center-table, .integration-catalog, .records-main, .dashboard-card-list, .composer-canvas"
              )
            ].find((element) => {
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0;
            });
            if (!candidate) return null;
            for (
              let element = candidate;
              element && element !== document.body;
              element = element.parentElement
            ) {
              if (element.scrollHeight > element.clientHeight + 1) {
                element.scrollTop = element.scrollHeight;
              }
            }
            const rect = candidate.getBoundingClientRect();
            return {
              x: Math.max(1, Math.min(innerWidth - 2, rect.left + rect.width / 2)),
              y: Math.max(
                1,
                Math.min(
                  innerHeight - 2,
                  rect.top + Math.min(rect.height, innerHeight - rect.top) / 2
                )
              )
            };
          });
          if (wheelProbe) {
            await page.mouse.move(wheelProbe.x, wheelProbe.y);
            await page.mouse.wheel(0, 500);
            await page.mouse.wheel(0, 500);
            await page.waitForTimeout(150);
            if ((await page.evaluate(() => window.scrollY)) === 0) {
              errors.push("Vertical wheel input did not reach the main page");
            }
          }
        }
        if (route.endsWith("tab=Proposals") && !demoMode) {
          await waitForRealtime(page, errors, requests);
          await page.getByLabel("Title", { exact: true }).fill("Unsaved title");
          await page.locator(".proposal-field textarea").first().fill("Unsaved proposal content");
          await page.evaluate(() => {
            window.auditEditor = document.querySelector(".proposal-editor");
            for (let i = 0; i < 3; i++)
              window.auditSocket.onmessage({
                data: JSON.stringify({
                  type: "realtime:update",
                  entityType: "lead",
                  leadId: "lead_1",
                  action: "proposal-updated",
                  occurredAt: new Date().toISOString()
                })
              });
          });
          await page.waitForTimeout(500);
          const preserved = await page.evaluate(
            () => window.auditEditor === document.querySelector(".proposal-editor")
          );
          if (
            !preserved ||
            (await page.getByLabel("Title", { exact: true }).inputValue()) !== "Unsaved title" ||
            (await page.locator(".proposal-field textarea").first().inputValue()) !==
              "Unsaved proposal content"
          ) {
            errors.push("Proposal refresh replaced the editor or lost unsaved changes");
          }
        }
        if (!demoMode && (route === "/dashboard" || route === "/operations")) {
          await waitForRealtime(page, errors, requests);
          const endpoint =
            route === "/dashboard" ? "/api/action-dashboard" : "/api/operations/dashboard";
          const before = requests.filter((p) => p === endpoint).length;
          const expectedScroll = await page.evaluate(() => {
            window.scrollTo(0, 200);
            window.auditPanel = document.querySelector(".dashboard-hero");
            for (let i = 0; i < 5; i++)
              window.auditSocket.onmessage({
                data: JSON.stringify({
                  type: "realtime:update",
                  entityType: "lead",
                  action: "changed",
                  occurredAt: new Date().toISOString()
                })
              });
            return window.scrollY;
          });
          await page.waitForTimeout(500);
          const count = requests.filter((p) => p === endpoint).length - before;
          const retained = await page.evaluate(
            (scrollPosition) =>
              window.auditPanel === document.querySelector(".dashboard-hero") &&
              window.scrollY === scrollPosition,
            expectedScroll
          );
          if (count !== 1 || !retained)
            errors.push(`${route}: burst fetches=${count}, retained=${retained}`);
        }
        results.push({ width, route, overflow, errors: [...errors] });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify(
      {
        output,
        screens: results.length,
        failures: results.filter(
          (r) => r.overflow.document || r.overflow.controls.length || r.errors.length
        )
      },
      null,
      2
    )
  );
  if (results.some((r) => r.overflow.document || r.overflow.controls.length || r.errors.length))
    process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
