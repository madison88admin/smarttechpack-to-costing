import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/nextgen/po/[id]/route";
import { issueSessionToken } from "./helpers/session";

// Route-level tests for GET /api/nextgen/po/[id].
//
// The route calls nextGenGet and falls back to nextGenPost, both of which reject
// on a transport or session failure. Unhandled, that answered a bodiless 500
// after ~35 seconds of waiting (observed live with an unknown PO id), which tells
// the caller nothing. It now answers the same upstream contract the sibling PO
// routes use.

const { session, mocks } = vi.hoisted(() => ({
  session: { token: null as string | null },
  mocks: { get: null as unknown, post: null as unknown }
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (session.token ? { value: session.token } : undefined) })
}));

vi.mock("@/lib/nextgen/client", () => ({
  nextGenGet: (...args: unknown[]) => (mocks.get as (...a: unknown[]) => unknown)(...args),
  nextGenPost: (...args: unknown[]) => (mocks.post as (...a: unknown[]) => unknown)(...args)
}));

const call = async () =>
  GET(new Request("http://localhost/api/nextgen/po/48021"), { params: { id: "48021" } } as never);

afterEach(() => {
  session.token = null;
  mocks.get = null;
  mocks.post = null;
});

describe("GET /api/nextgen/po/[id]", () => {
  it("answers 400 without a session (viewer)", async () => {
    session.token = await issueSessionToken("viewer");
    const res = await call();
    expect(res.status).toBe(400);
  });

  it("maps a rejected upstream call to a 502 with a reason, not an empty 500", async () => {
    session.token = await issueSessionToken("pbd");
    mocks.get = () => {
      throw new Error("connect ETIMEDOUT");
    };

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.upstreamStatus).toBe(502);
    expect(body.error).toContain("unavailable");
  });

  it("forwards a successful lookup", async () => {
    session.token = await issueSessionToken("pbd");
    mocks.get = async () => ({ ok: true, status: 200, upstreamContentType: "application/json", body: { Id: 48021 } });

    const res = await call();

    expect(res.status).toBe(200);
    expect((await res.json()).body).toEqual({ Id: 48021 });
  });

  it("falls back to the POST reader when the GET lookup fails", async () => {
    session.token = await issueSessionToken("pbd");
    mocks.get = async () => ({ ok: false, status: 404, upstreamContentType: "text/plain", body: { error: "not found" } });
    mocks.post = async () => ({ ok: true, status: 200, upstreamContentType: "application/json", body: { Id: 48021, Source: "poRead" } });

    const res = await call();

    expect(res.status).toBe(200);
    expect((await res.json()).body).toEqual({ Id: 48021, Source: "poRead" });
  });
});
