import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProductImage } from "../src/lib/nextgen/client";
import { invalidateNextGenSession } from "../src/lib/nextgen/session";

// Unit tests for fetchProductImage: it must never report a missing image when
// the real cause is an upstream problem (NextGen rejecting the login, NextGen
// not configured, or the endpoint itself erroring). Each failure path is
// logged with the entity id and returned as a distinct result kind.

const BASE = "https://nextgen.test";
const LOGIN_PAGE_HTML =
  '<html><body><form><input name="__RequestVerificationToken" type="hidden" value="tok123" />' +
  '<input name="UserName" type="text" /><input name="Password" type="password" /></form></body></html>';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BODY = Buffer.concat([PNG_MAGIC, Buffer.alloc(1200)]);

type StubOptions = {
  loginStatus?: number; // status returned by the POST /Account/Login
  loginSetCookie?: string | null; // set-cookie on the login POST (auth cookie)
  imageStatus?: number; // status returned by image endpoints
  imageThrows?: boolean; // image endpoints throw (network failure)
};

function stubNextGenFetch(options: StubOptions = {}) {
  let loginPosts = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/Account/Login")) {
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        loginPosts += 1;
        const headers: Record<string, string> = {};
        if (options.loginSetCookie != null) {
          headers["set-cookie"] = options.loginSetCookie;
          headers.location = "/";
        }
        return new Response("login result", { status: options.loginStatus ?? 302, headers });
      }
      return new Response(LOGIN_PAGE_HTML, {
        status: 200,
        headers: { "set-cookie": "FastReactAntiForgeryCookie=abc; path=/" }
      });
    }
    if (url.includes("/Document/")) {
      if (options.imageThrows) throw new Error("ECONNRESET: upstream down");
      const status = options.imageStatus ?? 200;
      return new Response(status === 200 ? new Uint8Array(PNG_BODY) : "no image", {
        status,
        headers: { "content-type": status === 200 ? "image/png" : "text/html" }
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, loginPosts: () => loginPosts };
}

beforeEach(() => {
  vi.stubEnv("NEXTGEN_BASE_URL", BASE);
  vi.stubEnv("NEXTGEN_USERNAME", "carlo");
  vi.stubEnv("NEXTGEN_PASSWORD", "secret");
  invalidateNextGenSession(); // fresh session per test
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  invalidateNextGenSession();
});

describe("fetchProductImage — failure classification", () => {
  it("returns login-failed (not not-found) when NextGen rejects the credentials", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // A rejected login re-renders the login page with 200 and no auth cookie.
    const { fetchMock } = stubNextGenFetch({ loginStatus: 200, loginSetCookie: null });

    const result = await fetchProductImage("1");

    expect(result).toEqual({
      ok: false,
      reason: "login-failed",
      detail: "NextGen login failed with status 200"
    });
    expect(fetchMock).toHaveBeenCalled();
    // The real cause is logged server-side with the entity id.
    const logged = String(errorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("product image 1");
    expect(logged).toContain("login failed");
    errorSpy.mockRestore();
  });

  it("returns not-configured when the NextGen credentials are missing", async () => {
    vi.stubEnv("NEXTGEN_USERNAME", undefined);
    vi.stubEnv("NEXTGEN_PASSWORD", undefined);

    const result = await fetchProductImage("2");

    expect(result).toEqual({
      ok: false,
      reason: "not-configured",
      detail: "NEXTGEN_USERNAME and NEXTGEN_PASSWORD are required"
    });
  });

  it("returns not-configured when NEXTGEN_BASE_URL is missing", async () => {
    vi.stubEnv("NEXTGEN_BASE_URL", undefined);

    const result = await fetchProductImage("3");

    expect(result).toEqual({ ok: false, reason: "not-configured", detail: "NEXTGEN_BASE_URL is not configured" });
  });

  it("returns login-failed when even a freshly refreshed session is rejected", async () => {
    const { fetchMock, loginPosts } = stubNextGenFetch({
      loginStatus: 302,
      loginSetCookie: "FastReactAuthentication=xyz; path=/",
      imageStatus: 302 // image endpoints always redirect to login
    });

    const result = await fetchProductImage("4");

    expect(result).toEqual({
      ok: false,
      reason: "login-failed",
      detail: "NextGen session was rejected by the image endpoints even after a fresh login"
    });
    // Attempt 0 rejected the session, forcing a fresh login for attempt 1.
    expect(loginPosts()).toBeGreaterThanOrEqual(2);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("returns upstream when the image endpoints fail on the network", async () => {
    stubNextGenFetch({ loginStatus: 302, loginSetCookie: "FastReactAuthentication=xyz; path=/", imageThrows: true });

    const result = await fetchProductImage("5");

    expect(result).toEqual({ ok: false, reason: "upstream", detail: "ECONNRESET: upstream down" });
  });
});

describe("fetchProductImage — success and genuine not-found", () => {
  it("returns the image bytes on success", async () => {
    stubNextGenFetch({ loginStatus: 302, loginSetCookie: "FastReactAuthentication=xyz; path=/" });

    const result = await fetchProductImage("6");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("image/png");
      expect(result.buffer.length).toBe(PNG_BODY.length);
      expect(result.buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    }
  });

  it("still returns not-found when the endpoints genuinely have no image", async () => {
    stubNextGenFetch({ loginStatus: 302, loginSetCookie: "FastReactAuthentication=xyz; path=/", imageStatus: 404 });

    const result = await fetchProductImage("7");

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});
