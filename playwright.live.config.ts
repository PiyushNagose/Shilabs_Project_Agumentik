import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env", quiet: true });

const webUrl =
  process.env.LIVE_FLOW_WEB_URL || `http://localhost:${process.env.WEB_PORT || "5174"}`;
const apiUrl =
  process.env.LIVE_FLOW_API_URL ||
  process.env.VITE_API_BASE_URL ||
  `http://localhost:${process.env.API_PORT || "4010"}`;
process.env.LIVE_FLOW_API_URL = apiUrl;

export default defineConfig({
  testDir: "./tests/live",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  timeout: 60000,
  expect: { timeout: 20000 },
  use: {
    baseURL: webUrl,
    locale: "en-IN",
    timezoneId: "Asia/Calcutta",
    screenshot: "on",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } }
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ],
  webServer: [
    {
      command: "npm run dev -w @shilabs/api",
      url: `${apiUrl}/health`,
      env: { API_PORT: new URL(apiUrl).port || "4010", WEB_ORIGIN: webUrl },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
    {
      command: `npm run dev -w @shilabs/web -- --port ${new URL(webUrl).port || "5174"}`,
      url: webUrl,
      env: { VITE_API_BASE_URL: apiUrl },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ]
});
