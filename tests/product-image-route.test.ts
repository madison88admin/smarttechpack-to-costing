import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/product/[entityId]/image/route";
import { issueSessionToken } from "./helpers/session";

// Route-level tests for GET /api/product/[entityId]/image: the endpoint must
// never let an upstream NextGen problem masquerade as a missing image (404) or
// a generic server error (500). Login/configuration/upstream failures are 502
// with a clear message; only a genuine no-image is 404.

const { session, mocks } = vi.hoisted(() => ({
  session: { token: null as string | null },
  mocks: { result: null as unknown }
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (session.token ? { value: session.token } : undefined) })
}));

vi.mock("@/lib/nextgen/client", () => ({
  fetchProductImage: () => mocks.result
}));

function request(entityId: string) {
  return new Request(`http://localhost/api/product/${entityId}/image`);
}

beforeEach(async () => {
  session.token = await issueSessionToken("viewer");
});

afterEach(() => {
  session.token = null;
  mocks.result = null;
});

describe("GET /api/product/[entityId]/image", () => {
  it("returns 401 without a session", async () => {
    session.token = null;

    const res = await GET(request("1"), { params: { entityId: "1" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 only for a genuine missing image", async () => {
    mocks.result = { ok: false, reason: "not-found" };

    const res = await GET(request("1"), { params: { entityId: "1" } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Image not found");
  });

  it("returns 502 (not 404/500) when NextGen login fails", async () => {
    mocks.result = { ok: false, reason: "login-failed", detail: "NextGen login failed with status 200" };

    const res = await GET(request("1"), { params: { entityId: "1" } });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("NextGen login failed");
  });

  it("returns 502 when NextGen is not configured", async () => {
    mocks.result = {
      ok: false,
      reason: "not-configured",
      detail: "NEXTGEN_USERNAME and NEXTGEN_PASSWORD are required"
    };

    const res = await GET(request("1"), { params: { entityId: "1" } });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("NextGen is not configured");
  });

  it("returns 502 when the upstream image endpoint errors", async () => {
    mocks.result = { ok: false, reason: "upstream", detail: "ECONNRESET: upstream down" };

    const res = await GET(request("1"), { params: { entityId: "1" } });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("NextGen image endpoint failed");
  });

  it("streams the image bytes on success with a cache header", async () => {
    const buffer = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(1200)
    ]);
    mocks.result = { ok: true, buffer, contentType: "image/png" };

    const res = await GET(request("1"), { params: { entityId: "1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("max-age=600");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(buffer)).toBe(true);
  });
});
