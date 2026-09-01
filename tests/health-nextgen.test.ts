import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/health/nextgen/route";

// Tests for GET /api/health/nextgen: it must report the NextGen integration's
// configuration, reachability, and login status distinctly, return 503 on any
// failure (never a bare 200), and support ?force=1 to force a fresh login.

const { mocks } = vi.hoisted(() => ({
  mocks: {
    login: null as (() => Promise<string>) | null,
    cached: false,
    invalidated: false
  }
}));

vi.mock("@/lib/nextgen/session", () => ({
  getNextGenSessionCookie: () => (mocks.login as () => Promise<string>)(),
  invalidateNextGenSession: () => {
    mocks.invalidated = true;
  },
  isNextGenSessionCached: () => mocks.cached
}));

const BASE = "https://nextgen.test";

function req(query = "") {
  return new Request(`http://localhost/api/health/nextgen${query}`);
}

beforeEach(() => {
  vi.stubEnv("NEXTGEN_BASE_URL", BASE);
  vi.stubEnv("NEXTGEN_USERNAME", "carlo");
  vi.stubEnv("NEXTGEN_PASSWORD", "secret");
  mocks.cached = false;
  mocks.invalidated = false;
  mocks.login = async () => "FastReactAuthentication=xyz";
  vi.stubGlobal("fetch", vi.fn(async () => new Response("login page", { status: 200 })));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.login = null;
  mocks.cached = false;
  mocks.invalidated = false;
});

describe("GET /api/health/nextgen", () => {
  it("returns 503 with distinct failure checks when configuration is missing", async () => {
    vi.stubEnv("NEXTGEN_BASE_URL", undefined);
    vi.stubEnv("NEXTGEN_USERNAME", undefined);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.checks.configuration.status).toBe("error");
    expect(body.checks.configuration.detail).toContain("NEXTGEN_BASE_URL");
    expect(body.checks.configuration.detail).toContain("NEXTGEN_USERNAME");
    expect(body.checks.reachable.status).toBe("skipped");
    expect(body.checks.login.status).toBe("skipped");
  });

  it("reports 200 with all checks ok on a healthy integration", async () => {
    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.checks.configuration).toEqual({ status: "ok" });
    expect(body.checks.reachable).toEqual({ status: "ok" });
    expect(body.checks.login).toEqual({ status: "ok", detail: "fresh login succeeded" });
    expect(body.timestamp).toBeTruthy();
  });

  it("reports the session source when the login is served from cache", async () => {
    mocks.cached = true;

    const body = await (await GET(req())).json();

    expect(body.checks.login).toEqual({ status: "ok", detail: "session reused from cache" });
  });

  it("reports reachability failure when NextGen does not answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.reachable).toEqual({ status: "error", detail: "ECONNRESET" });
  });

  it("reports login failure distinctly from reachability", async () => {
    mocks.login = async () => { throw new Error("NextGen login failed with status 200"); };

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.reachable).toEqual({ status: "ok" });
    expect(body.checks.login).toEqual({ status: "error", detail: "NextGen login failed with status 200" });
  });

  it("invalidates the cached session and forces a fresh login with ?force=1", async () => {
    const res = await GET(req("?force=1"));
    const body = await res.json();

    expect(mocks.invalidated).toBe(true);
    expect(body.force).toBe(true);
    expect(body.checks.login).toEqual({ status: "ok", detail: "fresh login succeeded" });
  });
});
