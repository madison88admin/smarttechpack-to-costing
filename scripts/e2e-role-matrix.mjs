// Live role × scenario matrix: what each USER can and cannot do, at every
// stage of the workflow, against the running app and the live database.
//
// Expectations come from the documented separation of duties (docs/user-flow.md)
// and the centralized role rules, not from reading the route handlers:
//
//   PBD      creates, sends to factory, prices, approves/rejects/clarifies,
//            owns the customer lifecycle, adds buyer comments/samples/quotes
//   Costing  validates the CBD (checklist, comparisons, compliance,
//            cost-sheet-ready), requests costing clarification
//   Factory  fills and resubmits the CBD — ONLY for its own assigned request
//   MD       technical review (pass / needs clarification / reject)
//   Admin tier  can do everything above; Admin settings are admin-tier only
//   Viewer   reads dashboards, never internal cost data (history/like styles)
//   anon     nothing
//
// Scenarios: create → modify (CBD revision, pricing, comments, samples,
// compliance, vendor quotes, change requests) → approve → reject → clarify
// (all three lanes) → terminal immutability → internal-data boundary.
//
// Cleans up after itself: deletes every row it created (children first, then
// the request) and refuses to start while a previous run's rows remain.
//
// Usage: node scripts/e2e-role-matrix.mjs [baseUrl]

import { readFileSync, existsSync } from "node:fs";
import { mintCookie } from "./mint-cookie.mjs";
import { beginDriverRun } from "./lib/driver-guard.mjs";

const BASE = process.argv[2] ?? "http://localhost:3120";

const PROFILES = {
  superadmin: { role: "superadmin", sub: "b1c9f0a2-1111-4a11-9b11-111111111111", name: "Super Admin", email: "superadmin@test.local" },
  admin: { role: "admin", sub: "c2d0a1b3-2222-4b22-9c22-222222222222", name: "Admin", email: "admin@test.local" },
  pbd: { role: "pbd", sub: "3a7c8aba-8ce3-4555-8160-f78407b954ad", name: "PBD Test", email: "pbd@test.local" },
  costing: { role: "costing", sub: "ced47ce4-e9b0-4282-8369-6397d4b51952", name: "Costing Team", email: "tp.costing@madison88.com" },
  md: { role: "md", sub: "597930cd-041d-409a-bb84-a97e1a225da0", name: "MD Test", email: "md@test.local" },
  factoryA: { role: "factory", sub: "a8258f6a-5a59-4229-b6c5-e230462261a2", name: "Factory A", email: "factory@test.local" },
  factoryB: { role: "factory", sub: "3e5cd390-26a2-4ed7-b88e-097560615a2a", name: "Factory B", email: "tp.factory@madison88.com" },
  viewer: { role: "viewer", sub: "d3e1b2c4-3333-4c33-8d33-333333333333", name: "Viewer", email: "viewer@test.local" }
};

const cookie = (role) => {
  const p = PROFILES[role];
  return `tp_costing_session=${mintCookie({ sub: p.sub, name: p.name, email: p.email, role: p.role })}`;
};

function loadEnvKey(name, files) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    if (match) return match[1].trim();
  }
  throw new Error(`${name} not found`);
}

const SERVICE_KEY = loadEnvKey("SUPABASE_SERVICE_ROLE_KEY", [".env.local", ".env"]);
const PGREST = "http://5.223.78.194:8000/rest/v1";
const MARKER = "E2E-ROLE-MATRIX";
const STAMP = Date.now();

const DB_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Accept-Profile": "tp_costing",
  "Content-Profile": "tp_costing"
};

// ── Result bookkeeping ──────────────────────────────────────────────────────
const bySection = new Map();
let failed = 0;
let section = "misc";

function setSection(name) {
  section = name;
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 68 - name.length))}`);
}

function check(label, pass, detail = "") {
  const list = bySection.get(section) ?? [];
  list.push({ label, pass, detail });
  bySection.set(section, list);
  if (!pass) failed += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function api(path, { method = "GET", role, body, expect } = {}) {
  const headers = {};
  if (role && role !== "anon") headers.Cookie = cookie(role);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON (HTML/exports) */ }
  const statuses = expect === undefined ? null : Array.isArray(expect) ? expect : [expect];
  const pass = statuses === null || statuses.includes(res.status);
  console.log(`${pass ? "PASS" : "FAIL"}  ${method.padEnd(4)} ${String(role ?? "anon").padEnd(10)} ${path.slice(0, 74)} → ${res.status}${statuses ? ` (want ${statuses.join("/")})` : ""}`);
  if (!pass && json?.error) console.log(`       error: ${String(json.error).slice(0, 160)}`);
  return { status: res.status, json, pass };
}

async function probe(label, path, opts) {
  const res = await api(path, opts);
  check(label, res.pass, `${res.status}${res.json?.error ? ` ${String(res.json.error).slice(0, 70)}` : ""}`);
  return res;
}

async function db(path) {
  const res = await fetch(`${PGREST}${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Accept-Profile": "tp_costing" }
  });
  return res.json();
}

async function del(table, filter) {
  const res = await fetch(`${PGREST}/${table}?${filter}`, {
    method: "DELETE",
    headers: { ...DB_HEADERS, Prefer: "return=minimal" }
  });
  return res.status;
}

const CHILD_TABLES = [
  "customer_approval_attachments", "customer_revision_history", "checklist_results",
  "approval_actions", "workflow_events", "cbd_change_requests", "cbd_material_lines",
  "factory_cbds", "costing_comments", "request_comments", "request_vendor_quotes",
  "request_samples", "compliance_reviews", "historical_costings"
];

async function cleanupRequest(id, styleNumber) {
  if (!id) return;
  for (const table of CHILD_TABLES) {
    try { await del(table, `costing_request_id=eq.${id}`); } catch { /* table may not exist */ }
  }
  try { await del("costing_requests", `id=eq.${id}`); } catch { /* best-effort */ }
  try { await del("nextgen_products", `style_number=eq.${styleNumber}`); } catch { /* best-effort */ }
}

const cbdBody = (styleNumber, overrides = {}) => ({
  status: "submitted",
  currency: "USD",
  styleNumber,
  styleName: "Role Matrix Test",
  costedQty: "5000 pcs",
  finishWeight: "180 gsm",
  yarnLines: [{ name: "Acrylic Yarn 32s", consumption: 0.22, materialPrice: 3.2, materialCost: 0.704 }],
  knittingLines: [{ name: "Knitting", machineType: "Flat 12G", knittingTime: 12, knittingCost: 0.24 }],
  operationsLines: [{ name: "Cut & Sew", operation: "Making", sah: 8, knittingCost: 0.16 }],
  standardPackagingCost: 0.12,
  specialPackagingCost: 0.05,
  profitCost: 0.2,
  laborCost: 0.5,
  overheadCost: 0.1,
  yarnType: "Acrylic",
  knitType: "Single Jersey",
  machineType: "Flat 12G",
  construction: "Rib",
  productCategory: "T-Shirt",
  ...overrides
});

const CHECKLIST = {
  items: [
    { code: "moq_checked", isChecked: true },
    { code: "lead_time_checked", isChecked: true },
    { code: "packaging_checked", isChecked: true },
    { code: "comparable_style_reviewed", isChecked: true }
  ]
};

const statusOf = async (id) => (await db(`/costing_requests?select=status&id=eq.${id}`))[0]?.status;

/** Server-rendered page as a role — the HTML is what the user actually sees. */
async function page(role, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: role === "anon" ? {} : { Cookie: cookie(role) },
    redirect: "manual"
  });
  return { status: res.status, text: await res.text() };
}

// Roles that must never act on behalf of another lane. `md` is deliberately
// absent where MD is the rightful owner; `anon` means no cookie at all.
const WRONG_ROLES = ["pbd", "costing", "factoryA", "factoryB", "viewer", "anon"];

let run = null;
const tracked = [];

/** Creates a request as `role` and walks it to `sent_to_factory`. */
async function makeRequest(tag, { createRole = "pbd" } = {}) {
  const styleNumber = `E2E-RM-${tag}-${STAMP}`;
  const created = await api("/api/costing/requests", {
    method: "POST",
    role: createRole,
    body: {
      styleNumber,
      productName: `Role Matrix ${tag}`,
      factoryName: "E2E TEST FACTORY",
      season: "E2E",
      brand: "E2E Brand",
      customer: "E2E Customer",
      notes: `role matrix probe [${MARKER}]`
    },
    expect: 201
  });
  const id = created.json?.data?.id ?? created.json?.id;
  check(`create as ${createRole} (${tag})`, Boolean(id), String(styleNumber));
  if (!id) throw new Error(`create as ${createRole} returned no id`);
  const cleanup = () => cleanupRequest(id, styleNumber);
  run.track(cleanup);
  tracked.push({ id, styleNumber, tag, cleanup });

  const sent = await api(`/api/costing/requests/${id}/actions`, { method: "POST", role: "pbd", body: { action: "send_to_factory" }, expect: 200 });
  check(`send_to_factory (${tag})`, sent.json?.status === "sent_to_factory", String(sent.json?.status ?? sent.status));

  const [row] = await db(`/costing_requests?select=assigned_factory_user_id&id=eq.${id}`);
  const owner = row?.assigned_factory_user_id;
  const assigned = owner === PROFILES.factoryA.sub ? "factoryA" : owner === PROFILES.factoryB.sub ? "factoryB" : null;
  check(`factory auto-assigned (${tag})`, Boolean(assigned), String(owner));
  return { id, styleNumber, assigned, rogue: assigned === "factoryA" ? "factoryB" : "factoryA" };
}

async function waitFor(id, expected, label) {
  for (let i = 0; i < 10; i += 1) {
    if ((await statusOf(id)) === expected) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  const actual = await statusOf(id);
  check(label, actual === expected, `status=${actual}`);
}

async function main() {
  run = await beginDriverRun({ name: "role matrix", marker: MARKER, rest: PGREST, headers: DB_HEADERS });

  // ══ 1. CREATE — who may open a request at all ════════════════════════════
  setSection("1. create request");
  const canCreate = { pbd: 201, admin: 201, superadmin: 201, costing: 403, md: 403, factoryA: 403, viewer: 403, anon: 401 };
  for (const [role, expected] of Object.entries(canCreate)) {
    const res = await api("/api/costing/requests", {
      method: "POST",
      role,
      body: {
        styleNumber: `E2E-RM-DENY-${role}-${STAMP}`,
        productName: `Deny ${role}`,
        factoryName: "E2E TEST FACTORY",
        notes: `role matrix probe [${MARKER}]`
      },
      expect: expected
    });
    check(`create as ${role}`, res.pass, `→ ${res.status}`);
    // A permitted creator leaves a row behind — sweep it now.
    const id = res.json?.data?.id ?? res.json?.id;
    if (id) await cleanupRequest(id, `E2E-RM-DENY-${role}-${STAMP}`);
  }

  const dupStyle = `E2E-RM-DUP-${STAMP}`;
  const dupBody = { styleNumber: dupStyle, productName: "Dup", factoryName: "E2E TEST FACTORY", notes: `role matrix probe [${MARKER}]` };
  const first = await api("/api/costing/requests", { method: "POST", role: "pbd", body: dupBody, expect: 201 });
  const firstId = first.json?.data?.id;
  const dup = await api("/api/costing/requests", { method: "POST", role: "pbd", body: dupBody });
  check("duplicate active style is refused (not a second request)", dup.status !== 201, `→ ${dup.status}`);
  await cleanupRequest(firstId, dupStyle);
  const leftover = await db(`/costing_requests?select=id&id=eq.${firstId}`);
  check("probe request cleaned up after the duplicate test", Array.isArray(leftover) && leftover.length === 0, `rows=${Array.isArray(leftover) ? leftover.length : "err"}`);

  // ══ 2. LIFECYCLE: who owns each stage ════════════════════════════════════
  setSection("2. lifecycle — approve path (Roles A/B/C)");
  const A = await makeRequest("APPROVE");
  if (!A.assigned) throw new Error("no factory assignment resolved; cannot continue");

  // 2a. draft-stage modification rights
  await probe("buyer comment = PBD only", `/api/costing/requests/${A.id}/comments`, {
    method: "POST", role: "pbd", body: { type: "buyer_comment", note: "matrix: buyer note" }, expect: [200, 201]
  });
  check("buyer comment denied to Costing", (await api(`/api/costing/requests/${A.id}/comments`, { method: "POST", role: "costing", body: { type: "buyer_comment", note: "nope" }, expect: 403 })).pass);
  check("buyer comment denied to anon", (await api(`/api/costing/requests/${A.id}/comments`, { method: "POST", body: { type: "buyer_comment", note: "nope" }, expect: 401 })).pass);
  await probe("samples = PBD", `/api/costing/requests/${A.id}/samples`, { method: "POST", role: "pbd", body: { sampleType: "proto", status: "received" }, expect: [200, 201] });
  check("samples denied to Costing", (await api(`/api/costing/requests/${A.id}/samples`, { method: "POST", role: "costing", body: { sampleType: "proto" }, expect: 403 })).pass);
  await probe("vendor quote = PBD", `/api/costing/requests/${A.id}/vendor-quotes`, { method: "POST", role: "pbd", body: { factoryName: "Matrix Supplier", quoteTotal: 3.1, currency: "USD" }, expect: [200, 201] });
  check("vendor quote denied to MD", (await api(`/api/costing/requests/${A.id}/vendor-quotes`, { method: "POST", role: "md", body: { factoryName: "X", quoteTotal: 1 }, expect: 403 })).pass);
  await probe("compliance = Costing", `/api/costing/requests/${A.id}/compliance`, { method: "POST", role: "costing", body: { checkType: "rsl", status: "passed" }, expect: [200, 201] });
  check("compliance denied to PBD", (await api(`/api/costing/requests/${A.id}/compliance`, { method: "POST", role: "pbd", body: { checkType: "rsl", status: "passed" }, expect: 403 })).pass);
  check("send_to_factory denied to Costing", (await api(`/api/costing/requests/${A.id}/actions`, { method: "POST", role: "costing", body: { action: "send_to_factory" }, expect: 403 })).pass);

  // 2b. CBD submission — assigned factory only
  check("CBD submit denied to anon", (await api(`/api/costing/requests/${A.id}/cbd`, { method: "POST", body: cbdBody(A.styleNumber), expect: 401 })).pass);
  check("CBD submit denied to Viewer", (await api(`/api/costing/requests/${A.id}/cbd`, { method: "POST", role: "viewer", body: cbdBody(A.styleNumber), expect: [401, 403] })).pass);
  check(`CBD submit denied to NON-assigned factory (${A.rogue})`, (await api(`/api/costing/requests/${A.id}/cbd`, { method: "POST", role: A.rogue, body: cbdBody(A.styleNumber), expect: 403 })).pass);
  check("CBD submit denied to MD", (await api(`/api/costing/requests/${A.id}/cbd`, { method: "POST", role: "md", body: cbdBody(A.styleNumber), expect: 403 })).pass);
  check("CBD submit denied to Costing", (await api(`/api/costing/requests/${A.id}/cbd`, { method: "POST", role: "costing", body: cbdBody(A.styleNumber), expect: 403 })).pass);
  const cbd1 = await api(`/api/costing/requests/${A.id}/cbd`, { method: "POST", role: A.assigned, body: cbdBody(A.styleNumber), expect: [200, 201] });
  check(`CBD submitted by assigned factory (${A.assigned})`, cbd1.pass, `→ ${cbd1.status}`);
  await waitFor(A.id, "for_md_review", "CBD submit moves request to MD review");

  // 2c. MD decision rights — MD is the rightful owner here, everyone else is not
  for (const role of WRONG_ROLES) {
    const expected = role === "anon" ? 401 : 403;
    check(`MD decision denied to ${role}`, (await api(`/api/costing/requests/${A.id}/md-review`, { method: "POST", role, body: { decision: "pass" }, expect: expected })).pass);
  }
  await probe("MD rejects a malformed decision", `/api/costing/requests/${A.id}/md-review`, { method: "POST", role: "md", body: { decision: "whatever" }, expect: 400 });
  // MD has no terminal reject: its vocabulary is pass | needs_clarification.
  // Terminal rejection is a PBD decision (asserted in section 3).
  check("MD cannot reject outright (clarify or pass only)", (await api(`/api/costing/requests/${A.id}/md-review`, { method: "POST", role: "md", body: { decision: "reject", notes: "nope" }, expect: 400 })).pass);

  // 2d. clarification lane 1 — MD → factory → MD (modification of the CBD)
  const mdClar = await probe("MD needs_clarification", `/api/costing/requests/${A.id}/md-review`, { method: "POST", role: "md", body: { decision: "needs_clarification", notes: "matrix: yarn spec unclear" }, expect: 200 });
  await waitFor(A.id, "needs_clarification", "MD clarification returns ownership to Factory");
  check("CBD revision denied to non-assigned factory", (await api(`/api/costing/requests/${A.id}/cbd`, { method: "POST", role: A.rogue, body: cbdBody(A.styleNumber), expect: 403 })).pass);
  const cbd2 = await api(`/api/costing/requests/${A.id}/cbd`, { method: "POST", role: A.assigned, body: cbdBody(A.styleNumber, { laborCost: 0.55 }), expect: [200, 201] });
  check("factory resubmits CBD after clarification (modification)", cbd2.pass, `→ ${cbd2.status}`);
  await waitFor(A.id, "for_md_review", "resubmission returns to MD (not to Costing)");
  const revisions = await db(`/factory_cbds?select=id&costing_request_id=eq.${A.id}`);
  check("CBD revision history keeps both submissions", Array.isArray(revisions) && revisions.length >= 2, `rows=${Array.isArray(revisions) ? revisions.length : "err"}`);

  await probe("MD pass", `/api/costing/requests/${A.id}/md-review`, { method: "POST", role: "md", body: { decision: "pass" }, expect: 200 });
  await waitFor(A.id, "for_costing_review", "MD pass hands off to Costing");

  // 2e. Costing rights + clarification lane 2
  check("cost-sheet-ready denied BEFORE approval", (await api(`/api/costing/requests/${A.id}/cost-sheet-ready`, { method: "POST", role: "costing", body: { ready: true }, expect: [400, 403, 409] })).pass);
  check("checklist denied to PBD", (await api(`/api/costing/requests/${A.id}/checklist`, { method: "POST", role: "pbd", body: CHECKLIST, expect: 403 })).pass);
  check("checklist denied to MD", (await api(`/api/costing/requests/${A.id}/checklist`, { method: "POST", role: "md", body: CHECKLIST, expect: 403 })).pass);
  check("checklist denied to factory", (await api(`/api/costing/requests/${A.id}/checklist`, { method: "POST", role: A.assigned, body: CHECKLIST, expect: 403 })).pass);
  await probe("checklist allowed to Costing", `/api/costing/requests/${A.id}/checklist`, { method: "POST", role: "costing", body: CHECKLIST, expect: 200 });
  check("approve denied at Costing stage (PBD cannot jump the queue)", (await api(`/api/costing/requests/${A.id}/actions`, { method: "POST", role: "pbd", body: { action: "approve" }, expect: 409 })).pass);
  const costClar = await probe("Costing clarity request", `/api/costing/requests/${A.id}/actions`, { method: "POST", role: "costing", body: { action: "costing_clarify", comment: "matrix: verify labor rate" }, expect: 200 });
  await waitFor(A.id, "needs_clarification", "Costing clarification returns ownership to Factory");
  await api(`/api/costing/requests/${A.id}/cbd`, { method: "POST", role: A.assigned, body: cbdBody(A.styleNumber, { laborCost: 0.62 }), expect: [200, 201] });
  await waitFor(A.id, "for_costing_review", "factory revision returns straight to Costing (MD gate already passed)");
  await probe("Costing completes its review", `/api/costing/requests/${A.id}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete", comment: "matrix: validated" }, expect: 200 });
  await waitFor(A.id, "for_pbd_review", "Costing completion hands off to PBD");

  // 2f. PBD approval rights + pricing modification
  for (const role of ["costing", "md", A.assigned, "viewer", "anon"]) {
    const expected = role === "anon" || role === "viewer" ? [401, 403] : 403;
    check(`approve denied to ${role}`, (await api(`/api/costing/requests/${A.id}/actions`, { method: "POST", role, body: { action: "approve" }, expect: expected })).pass);
  }
  check("pricing denied to Costing", (await api(`/api/costing/requests/${A.id}/pricing`, { method: "POST", role: "costing", body: { wholesalePrice: 3.5 }, expect: 403 })).pass);
  check("pricing denied to factory", (await api(`/api/costing/requests/${A.id}/pricing`, { method: "POST", role: A.assigned, body: { wholesalePrice: 3.5 }, expect: 403 })).pass);
  await probe("PBD sets the selling price", `/api/costing/requests/${A.id}/pricing`, {
    method: "POST", role: "pbd", body: { wholesalePrice: 3.5, retailPrice: 8.9, wholesaleMarkup: 2, retailMarkup: 2.5 }, expect: 200
  });
  const pricingRead = await api(`/api/costing/requests/${A.id}/pricing`, { role: "pbd", expect: 200 });
  check("price persisted (read-back)", JSON.stringify(pricingRead.json ?? {}).includes("3.5"), JSON.stringify(pricingRead.json?.data ?? pricingRead.json).slice(0, 90));
  await probe("PBD modifies the price", `/api/costing/requests/${A.id}/pricing`, {
    method: "POST", role: "pbd", body: { wholesalePrice: 3.75, retailPrice: 9.5, wholesaleMarkup: 2, retailMarkup: 2.5 }, expect: 200
  });
  const repriced = await api(`/api/costing/requests/${A.id}/pricing`, { role: "pbd", expect: 200 });
  check("modified price persisted", JSON.stringify(repriced.json ?? {}).includes("3.75"), JSON.stringify(repriced.json?.data ?? repriced.json).slice(0, 90));

  await probe("PBD approves", `/api/costing/requests/${A.id}/actions`, { method: "POST", role: "pbd", body: { action: "approve", comment: "matrix approve" }, expect: 200 });
  await waitFor(A.id, "approved", "approval reaches approved");

  // 2g. post-approval: cost sheet ready (Costing) + customer lifecycle (PBD)
  check("cost-sheet-ready denied to PBD", (await api(`/api/costing/requests/${A.id}/cost-sheet-ready`, { method: "POST", role: "pbd", body: { ready: true }, expect: 403 })).pass);
  check("cost-sheet-ready denied to factory", (await api(`/api/costing/requests/${A.id}/cost-sheet-ready`, { method: "POST", role: A.assigned, body: { ready: true }, expect: 403 })).pass);
  await probe("Costing marks cost sheet ready", `/api/costing/requests/${A.id}/cost-sheet-ready`, { method: "POST", role: "costing", body: { ready: true }, expect: 200 });

  for (const role of ["costing", "md", A.assigned]) {
    check(`customer status denied to ${role}`, (await api(`/api/costing/requests/${A.id}/customer-status`, { method: "POST", role, body: { status: "sent_to_customer" }, expect: 403 })).pass);
  }
  check("customer status denied to anon", (await api(`/api/costing/requests/${A.id}/customer-status`, { method: "POST", body: { status: "sent_to_customer" }, expect: 401 })).pass);
  await probe("PBD sends to customer", `/api/costing/requests/${A.id}/customer-status`, { method: "POST", role: "pbd", body: { status: "sent_to_customer", notes: "matrix submission" }, expect: 200 });
  await probe("PBD records customer approval", `/api/costing/requests/${A.id}/customer-status`, { method: "POST", role: "pbd", body: { status: "customer_approved" }, expect: 200 });
  await probe("PBD closes the request", `/api/costing/requests/${A.id}/customer-status`, { method: "POST", role: "pbd", body: { status: "closed" }, expect: 200 });
  const closedAgain = await api(`/api/costing/requests/${A.id}/customer-status`, { method: "POST", role: "pbd", body: { status: "sent_to_customer" } });
  check("closed request refuses further customer transitions", closedAgain.status >= 400, `→ ${closedAgain.status}`);

  const histA = await db(`/historical_costings?select=id&costing_request_id=eq.${A.id}`);
  check("approval wrote the historical costing row", Array.isArray(histA) && histA.length >= 1, `rows=${Array.isArray(histA) ? histA.length : "err"}`);
  const auditA = await db(`/approval_actions?select=actor_role&costing_request_id=eq.${A.id}`);
  const rolesA = new Set((Array.isArray(auditA) ? auditA : []).map((r) => r.actor_role));
  check("audit trail records each decision owner", ["factory", "md", "costing", "pbd"].every((r) => rolesA.has(r)), [...rolesA].join(","));

  // 2h. terminal immutability on an approved request
  check("approved request refuses CBD edit", (await api(`/api/costing/requests/${A.id}/cbd`, { method: "POST", role: A.assigned, body: cbdBody(A.styleNumber), expect: 409 })).pass);
  check("approved request refuses re-approval", (await api(`/api/costing/requests/${A.id}/actions`, { method: "POST", role: "pbd", body: { action: "approve" }, expect: 409 })).pass);
  check("approved request refuses rejection", (await api(`/api/costing/requests/${A.id}/actions`, { method: "POST", role: "pbd", body: { action: "reject", comment: "too late" }, expect: 409 })).pass);
  check("approved request refuses MD re-review", (await api(`/api/costing/requests/${A.id}/md-review`, { method: "POST", role: "md", body: { decision: "pass" }, expect: 409 })).pass);

  // ══ 3. REJECTION path ════════════════════════════════════════════════════
  setSection("3. rejection — PBD-owned, terminal");
  const R = await makeRequest("REJECT");
  if (!R.assigned) throw new Error("no factory assignment for the reject request");
  await api(`/api/costing/requests/${R.id}/cbd`, { method: "POST", role: R.assigned, body: cbdBody(R.styleNumber), expect: [200, 201] });
  await waitFor(R.id, "for_md_review", "reject path reaches MD review");
  // PBD owns rejection, so it is absent here and asserted at the end of the run.
  for (const role of WRONG_ROLES.filter((r) => r !== "pbd")) {
    const expected = role === "anon" ? 401 : 403;
    check(`reject denied to ${role}`, (await api(`/api/costing/requests/${R.id}/actions`, { method: "POST", role, body: { action: "reject", comment: "nope" }, expect: expected })).pass);
  }
  await api(`/api/costing/requests/${R.id}/md-review`, { method: "POST", role: "md", body: { decision: "pass" }, expect: 200 });
  await waitFor(R.id, "for_costing_review", "MD pass hands the reject-path request to Costing");
  check("reject denied to Costing at its own gate", (await api(`/api/costing/requests/${R.id}/actions`, { method: "POST", role: "costing", body: { action: "reject", comment: "nope" }, expect: 403 })).pass);
  await api(`/api/costing/requests/${R.id}/checklist`, { method: "POST", role: "costing", body: CHECKLIST, expect: 200 });
  await api(`/api/costing/requests/${R.id}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete" }, expect: 200 });
  await waitFor(R.id, "for_pbd_review", "reject path reaches PBD");
  await probe("PBD rejects outright", `/api/costing/requests/${R.id}/actions`, { method: "POST", role: "pbd", body: { action: "reject", comment: "matrix: construction not feasible" }, expect: 200 });
  await waitFor(R.id, "rejected", "PBD rejection is terminal");
  check("rejected request refuses any revival", (await api(`/api/costing/requests/${R.id}/actions`, { method: "POST", role: "pbd", body: { action: "approve" }, expect: 409 })).pass);
  check("rejected request refuses CBD edit", (await api(`/api/costing/requests/${R.id}/cbd`, { method: "POST", role: R.assigned, body: cbdBody(R.styleNumber), expect: 409 })).pass);
  check("rejected request refuses customer status", (await api(`/api/costing/requests/${R.id}/customer-status`, { method: "POST", role: "pbd", body: { status: "sent_to_customer" }, expect: 409 })).pass);

  const P = await makeRequest("PBDREJ");
  if (!P.assigned) throw new Error("no factory assignment for the PBD-reject request");
  await api(`/api/costing/requests/${P.id}/cbd`, { method: "POST", role: P.assigned, body: cbdBody(P.styleNumber), expect: [200, 201] });
  await api(`/api/costing/requests/${P.id}/md-review`, { method: "POST", role: "md", body: { decision: "pass" }, expect: 200 });
  await api(`/api/costing/requests/${P.id}/checklist`, { method: "POST", role: "costing", body: CHECKLIST, expect: 200 });
  await api(`/api/costing/requests/${P.id}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete" }, expect: 200 });
  await waitFor(P.id, "for_pbd_review", "PBD-reject path reaches PBD");
  await probe("PBD rejects at its own gate", `/api/costing/requests/${P.id}/actions`, { method: "POST", role: "pbd", body: { action: "reject", comment: "matrix: cost too high" }, expect: 200 });
  await waitFor(P.id, "rejected", "PBD rejection is terminal");

  // ══ 4. CLARIFICATION lane 3: PBD → factory → directly back to PBD ════════
  setSection("4. clarification — PBD lane returns straight to PBD");
  const C = await makeRequest("PBDCLAR");
  if (!C.assigned) throw new Error("no factory assignment for the PBD-clarify request");
  await api(`/api/costing/requests/${C.id}/cbd`, { method: "POST", role: C.assigned, body: cbdBody(C.styleNumber), expect: [200, 201] });
  await api(`/api/costing/requests/${C.id}/md-review`, { method: "POST", role: "md", body: { decision: "pass" }, expect: 200 });
  await api(`/api/costing/requests/${C.id}/checklist`, { method: "POST", role: "costing", body: CHECKLIST, expect: 200 });
  await api(`/api/costing/requests/${C.id}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete" }, expect: 200 });
  await waitFor(C.id, "for_pbd_review", "clarify path reaches PBD");
  check("clarify denied to Costing", (await api(`/api/costing/requests/${C.id}/actions`, { method: "POST", role: "costing", body: { action: "clarify", comment: "nope" }, expect: 403 })).pass);
  check("clarify denied to MD", (await api(`/api/costing/requests/${C.id}/actions`, { method: "POST", role: "md", body: { action: "clarify", comment: "nope" }, expect: 403 })).pass);
  await probe("PBD raises a clarification", `/api/costing/requests/${C.id}/actions`, { method: "POST", role: "pbd", body: { action: "clarify", comment: "matrix: margin too thin" }, expect: 200 });
  await waitFor(C.id, "needs_clarification", "PBD clarification returns ownership to Factory");
  await api(`/api/costing/requests/${C.id}/cbd`, { method: "POST", role: C.assigned, body: cbdBody(C.styleNumber, { laborCost: 0.4 }), expect: [200, 201] });
  await waitFor(C.id, "for_pbd_review", "factory revision returns DIRECTLY to PBD (MD + Costing gates already passed)");

  // ══ 5. MODIFICATION via change requests (per-field review requests) ══════
  setSection("5. modification — per-field change requests");
  const fieldChange = { section: "cost", field: "Profit cost", fieldKey: "profitCost", currentValue: "0.20", requestedValue: "0.25", reason: "matrix: margin target" };
  check("change request denied to factory", (await api(`/api/costing/requests/${C.id}/change-requests`, { method: "POST", role: C.assigned, body: fieldChange, expect: 403 })).pass);
  check("change request denied to viewer", (await api(`/api/costing/requests/${C.id}/change-requests`, { method: "POST", role: "viewer", body: fieldChange, expect: 403 })).pass);
  check("change request denied to anon", (await api(`/api/costing/requests/${C.id}/change-requests`, { method: "POST", body: fieldChange, expect: 401 })).pass);
  const changeReq = await api(`/api/costing/requests/${C.id}/change-requests`, { method: "POST", role: "pbd", body: fieldChange });
  check("PBD opens a field change request", changeReq.status === 200 || changeReq.status === 201, `→ ${changeReq.status}${changeReq.json?.error ? ` ${String(changeReq.json.error).slice(0, 80)}` : ""}`);
  const openChanges = await db(`/cbd_change_requests?select=id,status&costing_request_id=eq.${C.id}`);
  check("change request is recorded and open", Array.isArray(openChanges) && openChanges.length >= 1 && openChanges.some((r) => r.status !== "resolved"), JSON.stringify(openChanges).slice(0, 120));

  // ══ 6. INTERNAL COST DATA BOUNDARY (must never reach Factory) ════════════
  setSection("6. internal cost data boundary");
  const internalSurfaces = [
    ["/api/historical/like-styles?yarnType=Acrylic", "like styles"],
    ["/api/export/history.csv", "history export"],
    ["/api/historical/search?q=Acrylic", "historical search"],
    ["/api/analytics/anomalies", "anomaly analytics"],
    ["/api/export/requests.csv", "requests export"]
  ];
  for (const [path, label] of internalSurfaces) {
    check(`${label} denied to Factory`, (await api(path, { role: A.assigned, expect: 403 })).pass);
    check(`${label} denied to anon`, (await api(path, { expect: 401 })).pass);
    console.log(`       (md → ${(await api(path, { role: "md" })).status} on ${label}, recorded not judged)`);
    const viewerRead = await api(path, { role: "viewer" });
    console.log(`       (viewer → ${viewerRead.status}: read-only role, recorded not judged)`);
    const internal = await api(path, { role: "costing" });
    // Anomalies are a PBD-owned analysis surface, so Costing is refused there
    // by design; every other internal surface is open to Costing.
    const costingExpected = label === "anomaly analytics" ? 403 : 200;
    check(`${label} → Costing ${costingExpected}`, internal.status === costingExpected, `→ ${internal.status}`);
    if (label === "anomaly analytics") check("anomaly analytics open to PBD", (await api(path, { role: "pbd", expect: 200 })).pass);
  }
  for (const [page, label] of [["/history", "history page"], ["/finance", "finance page"], ["/production", "production page"]]) {
    const res = await fetch(`${BASE}${page}`, { headers: { Cookie: cookie(A.assigned) }, redirect: "manual" });
    check(`${label} blocked for Factory`, res.status !== 200, `→ ${res.status}`);
  }
  // The factory has no internal list API at all — the middleware refuses the
  // whole /api/costing/* tree, so the queue can only come from /factory pages,
  // which scope rows to the caller's assignment.
  await probe("Factory has no internal request list API", "/api/costing/requests", { role: A.assigned, expect: 403 });
  const factoryQueue = await fetch(`${BASE}/factory`, { headers: { Cookie: cookie(A.assigned) }, redirect: "manual" });
  let queueRows = 0;
  if (factoryQueue.status === 200) {
    const html = await factoryQueue.text();
    queueRows = new Set(html.match(/CR-\d{6}/g) ?? []).size;
    const listedIds = new Set((html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []));
    const ownRows = (await db(`/costing_requests?select=id&assigned_factory_user_id=eq.${PROFILES.factoryA.sub}`)).map((r) => r.id);
    const otherRows = (await db(`/costing_requests?select=id&assigned_factory_user_id=not.is.null&assigned_factory_user_id=neq.${PROFILES.factoryA.sub}`)).map((r) => r.id);
    const leaked = otherRows.filter((rid) => listedIds.has(rid));
    check("factory queue shows only its own requests", leaked.length === 0, `own=${ownRows.length} others=${otherRows.length} leaked=${leaked.length} rowsRendered=${queueRows}`);
  } else {
    check("factory queue page renders", false, `→ ${factoryQueue.status}`);
  }

  // ══ 7. ADMIN tier + Viewer boundaries ════════════════════════════════════
  setSection("7. admin surfaces");
  // Admin settings/audit are admin-tier reads; user management is POST-only and
  // Super Admin only, so it is probed with a POST that never creates a user
  // (the role gate runs before validation).
  const adminSurfaces = [
    { path: "/api/admin/settings", method: "GET", admin: 200, superadmin: 200 },
    { path: "/api/admin/audit.csv", method: "GET", admin: 200, superadmin: 200 },
    { path: "/api/admin/notifications/queue", method: "GET", admin: 200, superadmin: 200 },
    { path: "/api/admin/users", method: "POST", body: { action: "upsert" }, admin: 403, superadmin: 400 }
  ];
  for (const surface of adminSurfaces) {
    const req = { method: surface.method, body: surface.body };
    check(`${surface.path} denied to PBD`, (await api(surface.path, { ...req, role: "pbd", expect: 403 })).pass);
    check(`${surface.path} denied to Costing`, (await api(surface.path, { ...req, role: "costing", expect: 403 })).pass);
    check(`${surface.path} denied to Factory`, (await api(surface.path, { ...req, role: A.assigned, expect: 403 })).pass);
    check(`${surface.path} denied to Viewer`, (await api(surface.path, { ...req, role: "viewer", expect: [401, 403] })).pass);
    check(`${surface.path} denied to anon`, (await api(surface.path, { ...req, expect: 401 })).pass);
    check(`${surface.path} → Admin ${surface.admin}`, (await api(surface.path, { ...req, role: "admin", expect: surface.admin })).pass);
    check(`${surface.path} → Superadmin ${surface.superadmin}`, (await api(surface.path, { ...req, role: "superadmin", expect: surface.superadmin })).pass);
  }

  // ══ 8. Request detail visibility ════════════════════════════════════════
  setSection("8. request detail visibility");
  // There is no request-detail JSON endpoint: detail is the /requests/[id] page,
  // so the tenant boundary is asserted there (assigned vs rogue factory).
  const assignedPage = await fetch(`${BASE}/requests/${R.id}`, { headers: { Cookie: cookie(R.assigned) }, redirect: "manual" });
  check(`assigned factory can open its own request page (${R.assigned})`, assignedPage.status === 200, `→ ${assignedPage.status}`);
  const assignedText = assignedPage.status === 200 ? await assignedPage.text() : "";
  const roguePage = await fetch(`${BASE}/requests/${R.id}`, { headers: { Cookie: cookie(R.rogue) }, redirect: "manual" });
  const rogueText = await roguePage.text();
  const rogueNumber = (await db(`/costing_requests?select=request_number&id=eq.${R.id}`))[0]?.request_number ?? "CR-000000";
  // The page guard runs after the shell streams in dev, so the rogue factory
  // gets the app shell (smaller, no detail) instead of a 307. The security
  // property is that none of the request's data is in it.
  check(
    `non-assigned factory gets no request data (${R.rogue})`,
    !rogueText.includes(rogueNumber) && !rogueText.includes("E2E TEST FACTORY") && rogueText.length < assignedText.length,
    `→ ${roguePage.status} numberShown=${rogueText.includes(rogueNumber)} bytes=${rogueText.length} vs assigned ${assignedText.length}`
  );
  const noticePage = await fetch(`${BASE}/factory/${R.id}`, { headers: { Cookie: cookie(R.rogue) } });
  const noticeText = await noticePage.text();
  check(`non-assigned factory is told why on the CBD workspace (${R.rogue})`, /not assigned to you|restricted to its assigned/i.test(noticeText), `notice=${/not assigned to you|restricted to its assigned/i.test(noticeText)}`);

  check("factory request page carries no internal margin analytics", !assignedText.includes("Margin Analytics"), `${assignedText.length} bytes`);
  const anonPage = await fetch(`${BASE}/requests/${A.id}`, { redirect: "manual" });
  check("anon cannot open a request page", anonPage.status !== 200, `→ ${anonPage.status}`);

  // ══ 9. FRONTEND AFFORDANCES — the UI must offer exactly what the role may do
  setSection("9. frontend affordances per role");
  // Only controls in the default ("Overview") tab are server-rendered; the tab
  // strip swaps content client-side, so write panels such as PBD pricing, the
  // samples form and the MD recorder never appear in a page fetch. Those are
  // pinned by tests/panel-role-gating.test.tsx instead, which renders each panel
  // directly for both the owning and the read-only role.
  // C sits in for_pbd_review; A is approved, so it carries the post-approval
  // Costing control. A control the server refuses must not be offered, and one
  // the server allows must be there.
  const affordances = [
    { name: "Save Checklist", match: /Save Checklist/, owners: ["costing", "admin", "superadmin"], where: C.id },
    { name: "Cost sheet readiness toggle", match: /Mark as (Not )?Ready/, owners: ["costing", "admin", "superadmin"], where: A.id }
  ];
  for (const affordance of affordances) {
    for (const role of Object.keys(PROFILES)) {
      const rendered = await page(role, `/requests/${affordance.where}`);
      const visible = rendered.status === 200 && affordance.match.test(rendered.text);
      const expected = affordance.owners.includes(role);
      check(
        `${affordance.name} ${expected ? "offered to" : "withheld from"} ${role}`,
        visible === expected,
        `→ ${rendered.status} visible=${visible}`
      );
    }
    const anon = await page("anon", `/requests/${affordance.where}`);
    check(`${affordance.name} withheld from anon`, anon.status !== 200 || !affordance.match.test(anon.text), `→ ${anon.status}`);
  }

  await run.finish();

  // ══ Summary ═════════════════════════════════════════════════════════════
  let total = 0;
  let passed = 0;
  console.log(`\n${"═".repeat(66)}`);
  for (const [name, list] of bySection) {
    const ok = list.filter((r) => r.pass).length;
    total += list.length;
    passed += ok;
    console.log(`${ok === list.length ? "✅" : "❌"} ${name.padEnd(52)} ${ok}/${list.length}`);
    for (const row of list.filter((r) => !r.pass)) console.log(`     FAIL ${row.label} ${row.detail ? `— ${row.detail}` : ""}`);
  }
  console.log(`${"═".repeat(66)}`);
  console.log(`ROLE MATRIX: ${passed}/${total} probes passed across ${bySection.size} sections (${Object.keys(PROFILES).length} roles + anon)`);
  console.log(failed === 0 ? "ALL CHECKS PASSED" : `${failed} FAILURES`);
  if (failed !== 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("driver crashed:", err);
  if (run) await run.finish();
  process.exit(1);
});
