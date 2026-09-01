import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/health/nextgen/route";
import { recordLoginFailure, resetLoginBackoff } from "../src/lib/nextgen/login-backoff";

// The NextGen health check must report backing-off instead of attempting a
// fresh login after repeated failures, and expose the window for monitors.
// Only the network session calls are mocked; the back-off state is real.

const { mocks } = vi.hoisted(() => ({
  mocks: {
    login: null as unknown,
    cached: false
  }
}));

vi.mock("@/lib/nextgen/session", () => ({
  getNextGenSessionCookie: () => (mocks.login as () => Promise<string>)(),
  isNextGenSessionCached: () => mocks.cached,
  invalidateNextGenSession: () => {}
}));

beforeEach(() => {
  vi.resetAllMocks();
  resetLoginBackoff();
  process.env.NEXTGEN_BASE_URL = "https://nextgen.example.com";
  process.env.NEXTGEN_USERNAME = "user";
  process.env.NEXTGEN_PASSWORD = "pass";
  mocks.login = vi.fn().mockResolvedValue("cookie");
  mocks.cached = false;
  // The route's reachability probe performs a real fetch; stub it so the
  // test never touches the network (login is already mocked via the module).
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
});

afterEach(() => {
  resetLoginBackoff();
  vi.unstubAllGlobals();
});

function callGet() {
  return GET(new Request("http://localhost/api/health/nextgen"));
}

describe("NextGen health check back-off", () => {
  it("reports ok on a fresh successful login", async () => {
    const response = await callGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.checks.login.status).toBe("ok");
    expect(body.checks.login.detail).toBe("fresh login succeeded");
    expect(body.backoff.active).toBe(false);
  });

  it("reports error after repeated login failures and blocks attempts", async () => {
    // Simulate the account being locked: two failed logins.
    recordLoginFailure();
    recordLoginFailure();

    const loginSpy = vi.fn();
    mocks.login = loginSpy;

    const response = await callGet();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.checks.login.status).toBe("error");
    expect(body.checks.login.detail).toContain("Backing off after 2 consecutive login failures");
    expect(body.backoff.active).toBe(true);
    expect(body.backoff.retryAfterSeconds).toBeGreaterThan(0);
    // The login function must NOT be called while backing off.
    expect(loginSpy).not.toHaveBeenCalled();
  });

  it("does not count a backing-off check as another failure", async () => {
    recordLoginFailure();
    recordLoginFailure();
    const before = await bodyAfter();
    // Several health checks during the window should not grow the counter.
    await callGet();
    await callGet();
    await callGet();
    const after = await bodyAfter();
    expect(before.failures).toBe(after.failures);
  });

  it("reset-backoff=1 clears the window", async () => {
    recordLoginFailure();
    recordLoginFailure();
    const response = await GET(new Request("http://localhost/api/health/nextgen?reset-backoff=1"));
    const body = await response.json();
    expect(body.backoff.active).toBe(false);
    expect(body.resetBackoff).toBe(true);
  });
});

async function bodyAfter() {
  const response = await callGet();
  const body = await response.json();
  return { failures: body.backoff.failures, active: body.backoff.active };
}
