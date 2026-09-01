import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../src/app/api/admin/check-bom-versions/route";
import { issueSessionToken } from "./helpers/session";

// Auth (admin vs cron secret) + result passthrough for the BOM version check
// route. The check logic itself is covered by tests/bom-versions.test.ts.

const { mocks } = vi.hoisted(() => ({
  mocks: {
    session: { token: null as string | null },
    check: null as unknown,
    preview: null as unknown
  }
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (mocks.session.token ? { value: mocks.session.token } : undefined) })
}));

vi.mock("@/lib/nextgen/bom-versions", () => ({
  checkBomVersions: (...args: unknown[]) =>
    (mocks.check as (...a: unknown[]) => Promise<unknown>)(...args),
  previewBomVersionCheck: () =>
    (mocks.preview as (...a: unknown[]) => Promise<unknown>)()
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.check = vi.fn().mockResolvedValue({
    checked: 3,
    changed: 1,
    alertedRequests: 2,
    baselined: 1,
    errors: []
  });
  mocks.preview = vi.fn().mockResolvedValue({
    activeRequests: 12,
    uniqueStyles: 5,
    baselined: 2
  });
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  vi.restoreAllMocks();
  mocks.session.token = null;
});

describe("POST /api/admin/check-bom-versions", () => {
  it("requires admin", async () => {
    mocks.session.token = await issueSessionToken("factory");
    const response = await POST(
      new Request("http://localhost/api/admin/check-bom-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      })
    );
    expect(response.status).toBe(403);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("runs the check for an admin and returns the summary", async () => {
    mocks.session.token = await issueSessionToken("admin");
    const response = await POST(
      new Request("http://localhost/api/admin/check-bom-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.changed).toBe(1);
    expect(body.alertedRequests).toBe(2);
  });

  it("authorizes via cron secret without a session", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    const response = await POST(
      new Request("http://localhost/api/admin/check-bom-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": "nightly-secret" },
        body: JSON.stringify({ limit: 50 })
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.check).toHaveBeenCalledWith(50);
  });

  it("rejects a wrong cron secret", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.session.token = null; // no session
    const response = await POST(
      new Request("http://localhost/api/admin/check-bom-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": "wrong" },
        body: JSON.stringify({})
      })
    );
    expect(response.status).toBe(403);
  });
});

describe("GET /api/admin/check-bom-versions", () => {
  it("returns the preview for admins", async () => {
    mocks.session.token = await issueSessionToken("admin");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.activeRequests).toBe(12);
    expect(body.uniqueStyles).toBe(5);
  });

  it("rejects non-admins", async () => {
    mocks.session.token = await issueSessionToken("viewer");
    const response = await GET();
    expect(response.status).toBe(403);
  });
});
