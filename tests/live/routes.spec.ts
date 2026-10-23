import { expect, test } from "@playwright/test";

const paths = [
  "/dashboard",
  "/crm",
  "/deals",
  "/contacts",
  "/companies",
  "/agents",
  "/workflows",
  "/integrations",
  "/ai-command-center",
  "/orders",
  "/operations",
  "/users",
  "/settings",
  "/reports"
];

test.beforeEach(async ({ context, request }) => {
  const apiUrl = process.env.LIVE_FLOW_API_URL || process.env.VITE_API_BASE_URL;
  const response = await request.post(`${apiUrl}/api/auth/login`, {
    data: {
      email: process.env.DEV_ADMIN_EMAIL,
      password: process.env.DEV_ADMIN_PASSWORD
    }
  });
  expect(response.ok()).toBeTruthy();
  const auth = (await response.json()) as { accessToken: string; user: unknown };
  await context.addInitScript((value) => {
    localStorage.setItem("shilabs.accessToken", value.accessToken);
    localStorage.setItem("shilabs.user", JSON.stringify(value.user));
  }, auth);
});

for (const path of paths) {
  test(`${path} loads persisted data after navigation and reload`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 500)
        errors.push(`HTTP ${String(response.status())} ${new URL(response.url()).pathname}`);
    });
    const waitForContent = async (): Promise<void> => {
      await expect(page.locator("main h1, main h2").first()).toBeVisible();
      await expect(
        page.locator(".state-block").filter({
          hasText: /loading|fetching|preparing|unavailable|could not/i
        })
      ).toHaveCount(0);
    };
    await page.goto(path);
    await waitForContent();
    await page.reload();
    await waitForContent();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath("verified.png"), fullPage: true });
  });
}
