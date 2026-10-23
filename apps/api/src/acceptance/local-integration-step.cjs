const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "@playwright/test");

// Step 22 deliberately verifies local adapters, without claiming external readiness.
async function main() {
  assert.equal(process.env.RUN_BROWSER_ACCEPTANCE, "true");
  const output = process.env.LIVE_FLOW_OUTPUT_DIR;
  const auth = JSON.parse(fs.readFileSync(path.join(output, "auth.json"), "utf8"));
  const apiUrl = process.env.LIVE_FLOW_API_URL;
  const headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    "Content-Type": "application/json"
  };
  for (const key of ["mailpit", "google-calendar", "zoho-bigin", "aws-ses"]) {
    const response = await fetch(`${apiUrl}/api/integrations/catalog/${key}/connect`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        displayName: key === "google-calendar" ? "Google Calendar (TEST ADAPTER)" : undefined
      })
    });
    assert.equal(response.status, 200, `Connect ${key}`);
  }
  const response = await fetch(`${apiUrl}/api/integrations`, { headers });
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  for (const key of ["mailpit", "google-calendar"]) {
    assert.equal(dashboard.connections.find((item) => item.key === key)?.status, "CONNECTED", key);
  }
  for (const key of ["zoho-bigin", "aws-ses"]) {
    assert.equal(
      dashboard.connections.find((item) => item.key === key)?.status,
      "NEEDS_ATTENTION",
      key
    );
  }
  for (const key of [
    "zoho-bigin",
    "aws-ses",
    "mailpit",
    "google-calendar",
    "openai",
    "gemini",
    "twilio-whatsapp",
    "meta-whatsapp",
    "twilio-voice",
    "exotel-voice"
  ]) {
    assert.ok(
      dashboard.catalog.some((item) => item.key === key),
      `Missing catalog item ${key}`
    );
  }
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(({ accessToken, user }) => {
      localStorage.setItem("shilabs.accessToken", accessToken);
      localStorage.setItem("shilabs.user", JSON.stringify(user));
    }, auth);
    await page.goto(`${process.env.LIVE_FLOW_WEB_URL}/integrations`);
    await page.getByRole("heading", { name: "Integrations", exact: true }).waitFor();
    await page.getByText("Google Calendar (TEST ADAPTER)", { exact: true }).waitFor();
    const pageCheck = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      adapterVisible: document.body.innerText.includes("TEST ADAPTER")
    }));
    assert.equal(pageCheck.horizontalOverflow, false);
    assert.equal(pageCheck.adapterVisible, true);
    assert.deepEqual(errors, []);
    const screenshot = path.join(output, "22-local-adapter-readiness.png");
    await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
    process.stdout.write(
      JSON.stringify({
        step: 22,
        mode: "TEST_ADAPTERS",
        externalCredentialsVerified: false,
        screenshot,
        pageCheck
      })
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exitCode = 1;
});
