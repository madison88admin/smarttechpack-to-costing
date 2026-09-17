import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ENDPOINTS, HOSTILE_NUMERIC, HOSTILE_TEXT, NUMERIC_PARAMS, mintJwt, mintToken } from "../scripts/fuzz-http.mjs";

const API_DIR = join(process.cwd(), "src/app/api");

function routeFiles(): string[] {
  return (readdirSync(API_DIR, { recursive: true }) as string[])
    .filter((name) => name.endsWith("/route.ts"))
    .map((name) => join(API_DIR, name));
}

function tablePathFor(file: string) {
  // src/app/api/foo/bar/route.ts -> /api/foo/bar
  return "/" + file.slice(API_DIR.length + 1, -"/route.ts".length).replaceAll("\\", "/");
}

// Literal query-param reads the routes actually perform. Covers the patterns
// used across the codebase: searchParams.get/getList("x"), the `params` alias
// (nextgen/bom/search), the `p()` helper (historical/like-styles), and the
// `pick()` helper (export register/report).
const PARAM_PATTERNS = [
  /searchParams\.(?:get|getList)\(\s*"([^"]+)"/g,
  /\bparams\.get\(\s*"([^"]+)"/g,
  /\bp\(\s*"([^"]+)"/g,
  /\bpick\(\s*"([^"]+)"/g
];

function sourceParams(file: string): Set<string> {
  const text = readFileSync(file, "utf8");
  const found = new Set<string>();
  for (const pattern of PARAM_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.add(match[1] as string);
  }
  return found;
}

const tableByPath = new Map(ENDPOINTS.map((ep) => [ep.path, ep]));

describe("HTTP fuzz harness — endpoint/param table stays in sync with the source", () => {
  it("every table endpoint maps to a real route file and is unique", () => {
    const seen = new Set();
    for (const ep of ENDPOINTS) {
      expect(ep.path, ep.path).toMatch(/^\/api\//);
      expect(seen.has(ep.path), `duplicate endpoint ${ep.path}`).toBe(false);
      seen.add(ep.path);
      expect(ep.params.length, `${ep.path} must fuzz at least one param`).toBeGreaterThan(0);
      expect(new Set(ep.params).size, `${ep.path} has duplicate params`).toBe(ep.params.length);
      expect(existsSync(join(API_DIR, `${ep.path.slice("/api".length)}/route.ts`)), `route file for ${ep.path} missing`).toBe(true);
      // Upstream-proxy endpoints may answer 502/503/504 gracefully when the
      // NextGen upstream is down — anything else still fails the harness.
      for (const code of ep.allow ?? []) {
        expect([502, 503, 504].includes(code), `${ep.path} allows unexpected status ${code}`).toBe(true);
      }
      // Only upstream proxies may be marked slow or requiresUpstream — a
      // DB-backed endpoint marked slow would silently weaken hang detection,
      // and marking it requiresUpstream would skip it in CI.
      // Endpoints that genuinely bind the NextGen upstream: the proxy routes
      // plus the admin sync action (which pulls via nextGenPost).
      const isUpstreamProxy =
        ep.path.startsWith("/api/health/nextgen") ||
        ep.path.startsWith("/api/nextgen/") ||
        ep.path.startsWith("/api/product/") ||
        ep.path === "/api/admin/sync-nextgen-historical";
      if (ep.slow) {
        expect(isUpstreamProxy, `${ep.path} is slow without being an upstream proxy`).toBe(true);
      }
      if (ep.requiresUpstream) {
        expect(isUpstreamProxy, `${ep.path} is requiresUpstream without being an upstream proxy`).toBe(true);
        expect(ep.allow?.length, `${ep.path} requiresUpstream but does not allow upstream 5xx`).toBeGreaterThan(0);
      }
    }
  });

  it("every query param the routes read is covered by the harness table", () => {
    const missing: string[] = [];
    for (const file of routeFiles()) {
      const path = tablePathFor(file);
      const ep = tableByPath.get(path);
      const params = sourceParams(file);
      for (const param of params) {
        if (!ep?.params.includes(param)) missing.push(`${path}?${param}`);
      }
    }
    expect(missing, `unfuzzed params — add them to ENDPOINTS in scripts/fuzz-http.mjs:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("every table param still exists as a read in the source (no drift after renames)", () => {
    const stale = [];
    for (const ep of ENDPOINTS) {
      const file = join(API_DIR, `${ep.path.slice("/api".length)}/route.ts`);
      const params = sourceParams(file);
      for (const param of ep.params) {
        if (!params.has(param)) stale.push(`${ep.path}?${param}`);
      }
    }
    expect(stale, `stale table params — removed from the route but still fuzzed:\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  it("numeric-flagged params are limited to the known numeric surface", () => {
    const known = new Set(["limit", "offset", "pageSize", "skip", "minScore"]);
    for (const name of NUMERIC_PARAMS) {
      expect(known.has(name), `NUMERIC_PARAMS contains unexpected "${name}"`).toBe(true);
    }
  });

  it("canonical hostile payloads keep the discovered regressions pinned", () => {
    // The space-laden value that hung the status filter, and the comma that
    // 500'd the search — if either is dropped, the harness stops guarding it.
    expect(HOSTILE_TEXT).toContain("x OR 1=1 --");
    expect(HOSTILE_TEXT).toContain("a,b");
    expect(HOSTILE_TEXT.some((v) => v.length > 10_000)).toBe(true);
    expect(HOSTILE_NUMERIC).toEqual(
      expect.arrayContaining(["999999999999999999", "abc", "-1", "1e309"])
    );
  });

  it("mintToken produces a session the app accepts (shape matches session.ts)", () => {
    const token = mintToken("x".repeat(40), "pbd");
    const [payload, sig] = token.split(".");
    expect(payload).toBeTruthy();
    expect(sig).toBeTruthy();
    expect(token.split(".")).toHaveLength(2);
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(body.role).toBe("pbd");
    expect(body.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  // The CI boot uses this as the PostgREST service-role key, so it has to be a
  // real JWT — a 2-part token (mintToken) makes PostgREST 401 every query.
  it("mintJwt produces a verifiable HS256 JWT with the role claim", () => {
    const secret = "y".repeat(40);
    const token = mintJwt(secret, "service_role");
    const [header, payload, sig] = token.split(".");
    expect(token.split(".")).toHaveLength(3);
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toMatchObject({ alg: "HS256", typ: "JWT" });
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(body.role).toBe("service_role");
    expect(body.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
    expect(sig).toBe(expected);
  });
});