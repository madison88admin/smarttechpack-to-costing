#!/usr/bin/env node
// HTTP fuzz harness: replays hostile query patterns into every list/search
// endpoint of the running app, asserting every response is fast (< timeout)
// and graceful (< 500).
//
// The endpoint/param table below is source-derived and pinned by
// tests/http-fuzz-harness.test.ts, so adding a new search param anywhere in
// src/app/api without fuzzing it here fails CI.
//
// Usage:
//   node scripts/fuzz-http.mjs                          # localhost, unauthenticated
//   node scripts/fuzz-http.mjs --base http://localhost:3120 --secret "$TP_COSTING_SESSION_SECRET"
//   node scripts/fuzz-http.mjs --roles pbd,admin --secret "$TP_COSTING_SESSION_SECRET"  # default npm run fuzz:http
//   node scripts/fuzz-http.mjs --base http://5.223.78.194:3110 --secret "$PROD_SECRET" --role admin
// Flags:
//   --base URL          base URL to probe (default http://localhost:3120)
//   --secret S          TP_COSTING_SESSION_SECRET — mints role tokens when given
//   --roles R1,R2       comma-separated roles — one authenticated pass each, plus unauthenticated
//   --role R            single role for the minted token (legacy; default pbd; use admin for /api/admin/*)
//   --skip-upstream     drop requiresUpstream endpoints (CI: no NextGen reachable)
//   --timeout-ms N      per-request hang threshold (default 4000)
//   --concurrency N     parallel probes (default 6)
// Exits 1 when any probe times out, errors, or answers >= 500.

import { createHmac, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export const SESSION_COOKIE = "tp_costing_session";

// Canonical hostile payloads — the discovered regressions live here:
//  - "x OR 1=1 --" (space-laden value) previously hung the status filter
//  - "a,b" (comma) previously 500'd the free-text search
//  - quotes, unicode, and 14KB of junk exercise the remaining parsers
export const HOSTILE_TEXT = [
  "x OR 1=1 --",
  "a,b",
  "' single'",
  '"quoted"',
  "drop table costing_requests;--",
  "😀 éñ ünïcode",
  "A".repeat(14 * 1024)
];

export const HOSTILE_NUMERIC = ["999999999999999999", "abc", "-1", "1e309"];

// Params the routes coerce with Number()/parseInt() — numeric hostile values
// are applied in addition to the text set. Pinned by the harness test.
export const NUMERIC_PARAMS = new Set(["limit", "offset", "pageSize", "skip", "minScore"]);

// Every list/search endpoint and the query params it reads, exactly as the
// source does (aliases like `style`/`material` included — they are real reads).
export const ENDPOINTS = [
  { path: "/api/admin/audit.csv", role: "admin", params: ["eventType", "q"] },
  { path: "/api/admin/logs.csv", role: "admin", params: ["q", "severity"] },
  { path: "/api/admin/recipients", role: "admin", params: ["id"] },
  { path: "/api/admin/sync-nextgen-historical", role: "admin", params: ["limit", "statuses"], allow: [502, 503, 504], slow: true, requiresUpstream: true },
  { path: "/api/comparison-sets", role: "pbd", params: ["requestId"] },
  { path: "/api/costing/requests", role: "pbd", params: ["factoryName", "limit", "offset", "q", "status", "styleNumber", "checkDuplicate"] },
  { path: "/api/costing/requests/[id]/photos", role: "pbd", params: ["photoId"] },
  { path: "/api/costing/requests/[id]/vendor-quotes", role: "pbd", params: ["id"] },
  { path: "/api/export/cbd-detail.csv", role: "pbd", params: ["requestId"] },
  { path: "/api/export/history.csv", role: "pbd", params: ["brand", "customer", "factory", "season", "q"] },
  { path: "/api/export/register.csv", role: "pbd", params: ["factory", "brand", "customer", "season", "status", "granularity", "from", "to", "sort", "dir"] },
  { path: "/api/export/register.xlsx", role: "pbd", params: ["factory", "brand", "customer", "season", "status", "granularity", "from", "to", "sort", "dir"] },
  { path: "/api/export/report.csv", role: "pbd", params: ["factory", "brand", "customer", "season", "status", "granularity", "from", "to"] },
  { path: "/api/export/report.xlsx", role: "pbd", params: ["factory", "brand", "customer", "season", "status", "granularity", "from", "to"] },
  { path: "/api/export/requests.csv", role: "pbd", params: ["q", "status"] },
  // NextGen upstream proxies: a fast 502/503/504 when the upstream is down is
  // graceful handling, not a regression — but an indefinite hang still fails.
  // `slow: true` gives them a longer per-request budget: the NextGen upstream
  // legitimately answers in 2–5s, unlike the DB-backed endpoints where >4s is
  // a hang.
  // NextGen upstream proxies cannot be fuzzed where no NextGen is reachable
  // (CI): the client throws on a failed upstream login, which 500s the route
  // regardless of the param. `requiresUpstream: true` marks them so CI runs
  // can skip them (--skip-upstream); environments with a reachable NextGen
  // (local dev, the VPS) keep fuzzing them.
  { path: "/api/health/nextgen", role: "admin", params: ["force", "reset-backoff"], allow: [503], slow: true, requiresUpstream: true },
  { path: "/api/nextgen/bom/search", role: "pbd", params: ["entityId", "styleNumber", "style", "materialName", "material", "category", "commodity", "materialId", "filter", "pageSize", "skip"], allow: [502, 503, 504], slow: true, requiresUpstream: true },
  { path: "/api/nextgen/mpo/search", role: "pbd", params: ["q"], allow: [502, 503, 504], slow: true, requiresUpstream: true },
  { path: "/api/nextgen/po/search", role: "pbd", params: ["q"], allow: [502, 503, 504], slow: true, requiresUpstream: true },
  // The PO-line reader: PBD-only (canCreateRequest), and both params are ID
  // lookups against the PO-line directory rather than free text.
  { path: "/api/nextgen/po/lines", role: "pbd", params: ["poId", "poNumber"], allow: [502, 503, 504], slow: true, requiresUpstream: true },
  { path: "/api/product/search", role: "pbd", params: ["q"], allow: [502, 503, 504], slow: true, requiresUpstream: true },
  { path: "/api/historical/like-styles", role: "pbd", params: ["limit", "minScore", "yarnType", "knitType", "machineType", "construction", "category", "factory", "brand", "customer", "season", "notes"] },
  { path: "/api/historical/search", role: "pbd", params: ["brand", "customer", "factory", "limit", "q", "season"] }
];

const FAKE_ID = "00000000-0000-4000-8000-000000000000";

function base64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

// Mirrors src/lib/auth/session.ts so the harness can act as a real role.
export function mintToken(secret, role) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(
    JSON.stringify({
      sub: randomUUID(),
      email: `fuzz-${role}@tp-costing.invalid`,
      name: `Fuzz ${role}`,
      role,
      iat: now,
      exp: now + 60 * 60 * 8
    })
  );
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

// PostgREST authenticates with a real JWT (header.payload.signature) carrying a
// `role` claim. mintToken above is the app's own 2-part session-cookie scheme, so
// a service-role key for PostgREST needs its own signer — using mintToken there
// produced a key PostgREST rejects, which 401'd every query in the CI boot.
export function mintJwt(secret, role, ttlSeconds = 60 * 60 * 8) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      role,
      iss: "supabase",
      iat: now,
      exp: now + ttlSeconds
    })
  );
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

async function probe(url, token, timeoutMs, allow) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
      redirect: "manual",
      signal: controller.signal
    });
    const allowed = allow?.includes(res.status) ?? false;
    const failed = res.status >= 500 && !allowed;
    // A 500 without its message is undiagnosable from CI, so keep the body.
    const body = failed ? (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300) : undefined;
    return { ok: !failed, status: res.status, ms: Date.now() - started, url, kind: failed ? "http>=500" : "http", body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      url,
      kind: error.name === "AbortError" ? "timeout" : "network",
      error: String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

export function buildProbes(base, endpoints, token, timeoutMs) {
  const probes = [];
  for (const ep of endpoints) {
    const basePath = ep.path.replaceAll("[id]", FAKE_ID);
    probes.push({ url: `${base}${basePath}`, label: `bare        ${ep.path}`, token, timeoutMs, allow: ep.allow, slow: ep.slow });
    for (const param of ep.params) {
      const values = NUMERIC_PARAMS.has(param) ? [...HOSTILE_NUMERIC, ...HOSTILE_TEXT] : HOSTILE_TEXT;
      for (const value of values) {
        probes.push({
          url: `${base}${basePath}?${param}=${encodeURIComponent(value)}`,
          label: `param       ${ep.path}?${param}=`,
          token,
          timeoutMs,
          allow: ep.allow,
          slow: ep.slow
        });
      }
    }
    const combined = ep.params.map((p) => `${p}=${encodeURIComponent(HOSTILE_TEXT[0])}`).join("&");
    probes.push({ url: `${base}${basePath}?${combined}`, label: `combined    ${ep.path}`, token, timeoutMs, allow: ep.allow, slow: ep.slow });
  }
  return probes;
}

async function runPool(items, concurrency, worker) {
  let next = 0;
  const results = new Array(items.length);
  async function pump() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, pump));
  return results;
}

async function warmUp(base, endpoints, token) {
  // Dev-mode Next recompiles route chunks on demand and answers 5xx while a
  // chunk is building — without a warmup those transient errors look like
  // real failures. Fire one bare request per endpoint (results discarded),
  // then probe. Production builds are already compiled, so this is a no-op
  // there beyond a single request per endpoint.
  const warmups = endpoints.map((ep) => ({
    url: `${base}${ep.path.replaceAll("[id]", FAKE_ID)}`,
    token,
    timeoutMs: 20000
  }));
  await runPool(warmups, 4, (p) => probe(p.url, p.token, p.timeoutMs, undefined));
}

// Runs one complete fuzz pass (warmup + probes) against one token identity.
async function runSinglePass({ base, endpoints, token, label, timeoutMs, concurrency }) {
  await warmUp(base, endpoints, token);
  const probes = buildProbes(base, endpoints, token, timeoutMs);
  console.log(`Fuzzing ${probes.length} hostile-query probes against ${base} (${label})`);
  const results = await runPool(probes, concurrency, (p) =>
    probe(p.url, p.token, p.slow ? Math.max(p.timeoutMs, 30000) : p.timeoutMs, p.allow)
  );
  for (let i = 0; i < results.length; i++) results[i].label = probes[i].label;

  const failures = results.filter((r) => !r.ok);
  const byKind = {};
  for (const r of failures) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

  for (const f of failures.slice(0, 20)) {
    console.log(`  FAIL [${f.kind}${f.status ? ` ${f.status}` : ""} in ${f.ms}ms] ${f.label}${f.error ? ` — ${f.error}` : ""}`);
    if (f.body) console.log(`       body: ${f.body}`);
  }
  if (failures.length > 20) console.log(`  …and ${failures.length - 20} more failures`);

  const ok = failures.length === 0;
  console.log(
    ok
      ? `ALL PASS — ${results.length} probes, no hangs (all < ${timeoutMs}ms), no 5xx`
      : `FAILED — ${failures.length}/${results.length} probes (${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")})`
  );
  return ok;
}

export async function runFuzz({ base = "http://localhost:3120", secret, role = "pbd", roles, timeoutMs = 4000, concurrency = 6, skipUpstream = false } = {}) {
  // `roles: ["pbd","admin"]` runs the unauthenticated pass plus one
  // authenticated pass per role, so role-gated routes (admin logs/audit,
  // settings, health) are fuzzed with a real token instead of being skipped
  // at the role guard. Without `roles`, keeps the legacy behavior: one pass
  // with `role` (or unauthenticated when no secret is given).
  const endpoints = skipUpstream ? ENDPOINTS.filter((ep) => !ep.requiresUpstream) : ENDPOINTS;
  if (skipUpstream) {
    const skipped = ENDPOINTS.length - endpoints.length;
    if (skipped > 0) console.log(`Skipping ${skipped} upstream-proxy endpoint(s) (no NextGen reachable here)`);
  }
  const rolePasses = roles?.length ? roles : secret ? [role] : [];
  const passes = [
    { label: "unauthenticated", token: null },
    ...rolePasses.map((r) => ({ label: `role=${r}`, token: secret ? mintToken(secret, r) : null }))
  ];
  let allOk = true;
  for (const pass of passes) {
    if (pass.token === null && pass.label !== "unauthenticated") {
      console.log(`SKIP ${pass.label} — no --secret given; pass requires a session secret`);
      continue;
    }
    const ok = await runSinglePass({ base, endpoints, token: pass.token, label: pass.label, timeoutMs, concurrency });
    allOk = allOk && ok;
  }
  return allOk;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
  };
  const base = value("--base", "http://localhost:3120");
  const secret = value("--secret", process.env.TP_COSTING_SESSION_SECRET ?? "");
  const role = value("--role", "pbd");
  const rolesArg = value("--roles", "");
  const roles = rolesArg ? rolesArg.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const timeoutMs = Number(value("--timeout-ms", "4000"));
  const concurrency = Number(value("--concurrency", "6"));
  const skipUpstream = args.includes("--skip-upstream");
  runFuzz({ base, secret: secret || undefined, role, roles, timeoutMs, concurrency, skipUpstream })
    .then((ok) => {
      process.exitCode = ok ? 0 : 1;
    })
    .catch((error) => {
      console.error(`Harness crashed: ${error}`);
      process.exitCode = 2;
    });
}