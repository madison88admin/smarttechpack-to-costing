import { test, expect, type APIRequestContext } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

async function serverUp() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function maybeSkip() {
  if (!(await serverUp())) {
    test.skip(true, `Dev server not reachable at ${BASE_URL} — start it with: npm run dev`);
  }
}

async function loginAs(request: APIRequestContext, role: string) {
  const username = `${role}@madison88.com`;
  const password = "test-password";

  const response = await request.post("/api/auth/login", {
    data: { username, password },
  });

  if (response.status() === 401) {
    test.skip(true, `Login failed for ${role} - pilot users may not be configured`);
    return;
  }

  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.ok).toBe(true);
  return body;
}

test.describe("Authentication", () => {
  test.beforeEach(async () => {
    await maybeSkip();
  });

  test("rejects invalid login", async ({ request }) => {
    const response = await request.post("/api/auth/login", {
      data: { username: "bad@test.com", password: "wrong" },
    });
    expect(response.status()).toBe(401);
  });

  test("accepts valid login when configured", async ({ request }) => {
    await loginAs(request, "pbd");
  });
});

test.describe("Requests", () => {
  test.beforeEach(async () => {
    await maybeSkip();
  });

  test("lists requests for authenticated user", async ({ request }) => {
    await loginAs(request, "pbd");
    const response = await request.get("/api/costing/requests");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("blocks unauthenticated access", async ({ request }) => {
    const response = await request.get("/api/costing/requests");
    expect(response.status()).toBe(401);
  });
});

test.describe("Workflow Actions", () => {
  test.beforeEach(async () => {
    await maybeSkip();
  });

  test("rejects invalid action", async ({ request }) => {
    await loginAs(request, "pbd");
    const response = await request.post("/api/costing/requests/fake-id/actions", {
      data: { action: "invalid_action" },
    });
    expect(response.status()).toBe(400);
  });

  test("blocks role-violating actions", async ({ request }) => {
    await loginAs(request, "factory");
    const response = await request.post("/api/costing/requests/fake-id/actions", {
      data: { action: "approve" },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe("CBD Submission", () => {
  test.beforeEach(async () => {
    await maybeSkip();
  });

  test("rejects CBD on an unowned request before payload validation", async ({ request }) => {
    await loginAs(request, "factory");
    const response = await request.post("/api/costing/requests/fake-id/cbd", {
      data: { currency: "USD", lines: [{ materialName: "", unitCost: "-1" }] },
    });
    // Ownership gate (403) fires before payload validation (400) — a factory
    // must never learn anything about a request that is not assigned to it.
    expect(response.status()).toBe(403);
  });
});

test.describe("Admin Routes", () => {
  test.beforeEach(async () => {
    await maybeSkip();
  });

  test("blocks non-admin from settings", async ({ request }) => {
    await loginAs(request, "pbd");
    const response = await request.get("/api/admin/settings");
    expect(response.status()).toBe(403);
  });

  test("allows admin settings access when configured", async ({ request }) => {
    await loginAs(request, "admin");
    const response = await request.get("/api/admin/settings");
    expect(response.ok()).toBe(true);
  });
});

test.describe("Export Routes", () => {
  test.beforeEach(async () => {
    await maybeSkip();
  });

  test("exports requests CSV when authenticated", async ({ request }) => {
    await loginAs(request, "pbd");
    const response = await request.get("/api/export/requests.csv");
    expect(response.ok()).toBe(true);
    const text = await response.text();
    expect(text.length).toBeGreaterThan(0);
  });

  test("exports history CSV when authenticated", async ({ request }) => {
    await loginAs(request, "pbd");
    const response = await request.get("/api/export/history.csv");
    expect(response.ok()).toBe(true);
  });
});
