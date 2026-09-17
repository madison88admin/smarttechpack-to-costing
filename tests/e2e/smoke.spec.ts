import { test, expect } from "@playwright/test";

async function serverUp() {
  try {
    const res = await fetch(`${process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"}/api/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function maybeSkip() {
  if (!(await serverUp())) {
    test.skip(true, `Dev server not reachable at ${process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"} — start it with: npm run dev`);
  }
}

test.describe("Smoke", () => {
  test.beforeEach(async () => {
    await maybeSkip();
  });

  test("health endpoint is up", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  test("homepage loads", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Smart TP/);
  });

  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("form")).toBeVisible();
  });
});
