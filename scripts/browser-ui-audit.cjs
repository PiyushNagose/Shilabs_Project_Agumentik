/* Read-only browser audit using the web suite's isolated response fixtures. */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const source = fs.readFileSync("apps/web/src/app/App.test.tsx", "utf8");
  const fixtures = source.slice(source.indexOf("const adminUser"), source.indexOf("function mockCrmFetch"));
  const compiled = ts.transpile(fixtures, { target: ts.ScriptTarget.ES2022 });
  const data = new Function(compiled + ";return { adminUser, crmFetch, generatedProposal, currentMeetingRequest, followUpSequence };")();
  const output = path.join(os.tmpdir(), "shilabs-ui-audit", "screenshots");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const results = [];
  try {
    for (const width of [1440, 768, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      const errors = [];
      const requests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((user) => {
        localStorage.setItem("shilabs.accessToken", "isolated-ui-audit");
        localStorage.setItem("shilabs.user", JSON.stringify(user));
        window.WebSocket = class {
          constructor() { window.auditSocket = this; setTimeout(() => this.onopen?.(), 0); }
          close() { this.onclose?.(); }
        };
      }, data.adminUser);
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        requests.push(new URL(request.url()).pathname);
        if (request.method() !== "GET") throw new Error("Audit attempted a mutation: " + request.url());
        const url = request.url();
        let body;
        if (url.includes("/api/proposals?")) body = [data.generatedProposal];
        else if (url.includes("/api/meetings/requests?")) body = [data.currentMeetingRequest];
        else if (url.includes("/api/followups/leads/")) body = [data.followUpSequence];
        else body = await (await data.crmFetch(url)).json();
        await route.fulfill({ json: body });
      });
      for (const route of ["/dashboard", "/operations", ...["Overview", "Conversation", "Qualification", "Proposals", "Activities", "Meetings", "Deal", "AI Insights"].map((tab) => "/crm/leads/lead_1?tab=" + encodeURIComponent(tab)), "/users", "/settings"]) {
        await page.goto("http://localhost:5174" + route);
        await page.waitForLoadState("networkidle");
        const name = route.replace(/[^a-zA-Z0-9]+/g, "-");
        await page.screenshot({ path: path.join(output, `${width}${name}.png`), fullPage: true });
        const overflow = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth > innerWidth + 1,
          controls: [...document.querySelectorAll("button, .status-badge, input, textarea")]
            .filter((el) => el.getBoundingClientRect().width > 0 && el.scrollWidth > el.clientWidth + 2 && el.tagName !== "TEXTAREA" && el.tagName !== "INPUT")
            .map((el) => el.textContent.trim().slice(0, 100))
        }));
        if (route.endsWith("tab=Proposals")) {
          await page.getByLabel("Title", { exact: true }).fill("Unsaved title");
          await page.locator(".proposal-field textarea").first().fill("Unsaved proposal content");
          await page.evaluate(() => {
            window.auditEditor = document.querySelector(".proposal-editor");
            for (let i = 0; i < 3; i++) window.auditSocket.onmessage({ data: JSON.stringify({
              type: "realtime:update", entityType: "lead", leadId: "lead_1",
              action: "proposal-updated", occurredAt: new Date().toISOString()
            }) });
          });
          await page.waitForTimeout(500);
          const preserved = await page.evaluate(() => window.auditEditor === document.querySelector(".proposal-editor"));
          if (!preserved || await page.getByLabel("Title", { exact: true }).inputValue() !== "Unsaved title" ||
            await page.locator(".proposal-field textarea").first().inputValue() !== "Unsaved proposal content") {
            errors.push("Proposal refresh replaced the editor or lost unsaved changes");
          }
        }
        if (route === "/dashboard" || route === "/operations") {
          const endpoint = route === "/dashboard" ? "/api/action-dashboard" : "/api/operations/dashboard";
          const before = requests.filter((p) => p === endpoint).length;
          await page.evaluate(() => {
            window.scrollTo(0, 200);
            window.auditPanel = document.querySelector(".dashboard-hero");
            for (let i = 0; i < 5; i++) window.auditSocket.onmessage({ data: JSON.stringify({
              type: "realtime:update", entityType: "lead", action: "changed", occurredAt: new Date().toISOString()
            }) });
          });
          await page.waitForTimeout(500);
          const count = requests.filter((p) => p === endpoint).length - before;
          const retained = await page.evaluate(() => window.auditPanel === document.querySelector(".dashboard-hero") && window.scrollY === 200);
          if (count !== 1 || !retained) errors.push(`${route}: burst fetches=${count}, retained=${retained}`);
        }
        results.push({ width, route, overflow, errors: [...errors] });
      }
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ output, screens: results.length, failures: results.filter((r) => r.overflow.document || r.overflow.controls.length || r.errors.length) }, null, 2));
  if (results.some((r) => r.overflow.document || r.overflow.controls.length || r.errors.length)) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
