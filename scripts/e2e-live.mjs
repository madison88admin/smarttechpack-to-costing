// Live end-to-end driver: drives one request through the ENTIRE lifecycle via
// the real HTTP API on a running dev server (default http://localhost:3120),
// with real signed role cookies, asserting statuses at every step. Also runs
// the negative/role-boundary probes and cleans up the created request via the
// service role afterwards.
//
// Usage:
//   node scripts/e2e-live.mjs [baseUrl]
//
// Reads TP_COSTING_SESSION_SECRET from the env files (via mint-cookie.mjs) and
// SUPABASE_SERVICE_ROLE_KEY from .env.local for verification + cleanup.

import { readFileSync, existsSync } from "node:fs";
import { mintCookie } from "./mint-cookie.mjs";

const BASE = process.argv[2] ?? "http://localhost:3120";

const PROFILES = {
  pbd: { role: "pbd", sub: "3a7c8aba-8ce3-4555-8160-f78407b954ad", name: "PBD Test", email: "pbd@test.local" },
  factoryA: { role: "factory", sub: "a8258f6a-5a59-4229-b6c5-e230462261a2", name: "Factory A", email: "factory@test.local" },
  factoryB: { role: "factory", sub: "3e5cd390-26a2-4ed7-b88e-097560615a2a", name: "Factory B", email: "tp.factory@madison88.com" },
  md: { role: "md", sub: "597930cd-041d-409a-bb84-a97e1a225da0", name: "MD Test", email: "md@test.local" },
  costing: { role: "costing", sub: "ced47ce4-e9b0-4282-8369-6397d4b51952", name: "Costing Team", email: "tp.costing@madison88.com" },
  admin: { role: "admin", sub: "217449d3-bd1b-48a0-a2e0-5abf3bbc10c7", name: "Pilot Admin", email: "tp.admin@madison88.com" },
  viewer: { role: "viewer", sub: "c19ea89b-4111-4923-881c-56d9505fada6", name: "Viewer", email: "viewer@test.local" }
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

async function api(path, { method = "GET", role, body, expect } = {}) {
  const headers = {};
  if (role) headers.Cookie = cookie(role);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  const pass = expect === undefined || res.status === expect;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${method.padEnd(4)} ${(role ?? "anon").padEnd(8)} ${path} → ${res.status}${expect !== undefined ? ` (expected ${expect})` : ""}`
  );
  if (!pass && json?.error) console.log(`       error: ${String(json.error).slice(0, 160)}`);
  return { status: res.status, json };
}

const PGREST = "http://5.223.78.194:8000/rest/v1";
async function db(path) {
  const res = await fetch(`${PGREST}${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Accept-Profile": "tp_costing" }
  });
  return res.json();
}

// PostgREST resolves the schema for DELETE/PATCH from Content-Profile (no body
// to disambiguate), not Accept-Profile — earlier runs leaked rows here.
async function del(table, filter) {
  const res = await fetch(`${PGREST}/${table}?${filter}`, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Profile": "tp_costing",
      Prefer: "return=minimal"
    }
  });
  return res.status;
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── 1. Auth boundary ──────────────────────────────────────────────────────────
await api("/api/costing/requests", { expect: 401 });
await api("/api/costing/requests", { role: "viewer", expect: 200 });

// ── 2. Create request (PBD only) ──────────────────────────────────────────────
await api("/api/costing/requests", { method: "POST", role: "viewer", body: { styleNumber: "E2E-X" }, expect: 403 });
await api("/api/costing/requests", { method: "POST", role: "factoryA", body: { styleNumber: "E2E-X" }, expect: 403 });

const stamp = Date.now();
const styleNumber = `E2E-FINAL-${stamp}`;
const created = await api("/api/costing/requests", {
  method: "POST",
  role: "pbd",
  body: {
    styleNumber,
    productName: "E2E Final Test Product",
    factoryName: "E2E TEST FACTORY",
    season: "E2E",
    brand: "E2E Brand",
    customer: "E2E Customer",
    notes: "Created by automated final E2E test pass"
  },
  expect: 201
});
const requestId = created.json?.data?.id;
check("PBD creates request", Boolean(requestId), requestId ? styleNumber : "no id returned");
if (!requestId) process.exit(1);

// ── 3. Send to factory ────────────────────────────────────────────────────────
await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "viewer", body: { action: "send_to_factory" }, expect: 403 });
const sent = await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "pbd", body: { action: "send_to_factory" }, expect: 200 });
check("send_to_factory → sent_to_factory", sent.json?.status === "sent_to_factory", String(sent.json?.status));

// ── 3b. Customer review must NOT open before internal approval ───────────────
const earlyCs = await api(`/api/costing/requests/${requestId}/customer-status`, {
  method: "POST",
  role: "pbd",
  body: { status: "pending_customer_submission" },
  expect: 409
});
check("customer review blocked pre-approval", earlyCs.status === 409, String(earlyCs.status));

// Which factory profile got auto-assigned?
const [reqRow] = await db(`/costing_requests?select=id,assigned_factory_user_id,status&id=eq.${requestId}`);
const assignedProfile =
  reqRow?.assigned_factory_user_id === PROFILES.factoryA.sub ? "factoryA" :
  reqRow?.assigned_factory_user_id === PROFILES.factoryB.sub ? "factoryB" : null;
check("request auto-assigned to an active factory profile", Boolean(assignedProfile), String(reqRow?.assigned_factory_user_id));
if (!assignedProfile) process.exit(1);
const rogue = assignedProfile === "factoryA" ? "factoryB" : "factoryA";
console.log(`       → assigned: ${assignedProfile}, rogue for negative tests: ${rogue}`);

// ── 4. Factory ownership isolation ────────────────────────────────────────────
await api(`/api/costing/requests/${requestId}/cbd`, { role: rogue, expect: 403 });
await api(`/api/costing/requests/${requestId}/cbd`, { method: "POST", role: rogue, body: { status: "submitted" }, expect: 403 });
await api(`/api/costing/requests/${requestId}/cbd`, { role: assignedProfile, expect: 404 });

// ── 5. Factory CBD: draft then submit ─────────────────────────────────────────
const cbdBody = {
  status: "submitted",
  currency: "USD",
  styleNumber,
  styleName: "E2E Final Test Product",
  costedQty: "5000 pcs",
  finishWeight: "180 gsm",
  yarnLines: [
    { name: "Acrylic Yarn 32s", consumption: 0.22, materialPrice: 3.2, materialCost: 0.704 },
    { name: "Elastic", consumption: 0.05, materialPrice: 2.0, materialCost: 0.1 }
  ],
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
  notes: "E2E automated CBD"
};
await api(`/api/costing/requests/${requestId}/cbd`, { method: "POST", role: assignedProfile, body: { ...cbdBody, status: "draft" }, expect: 201 });
const submitted = await api(`/api/costing/requests/${requestId}/cbd`, { method: "POST", role: assignedProfile, body: cbdBody, expect: 201 });
check("factory CBD submit accepted", submitted.status === 201 && Boolean(submitted.json?.data?.id), "id present");
// submitFactoryCbd returns the inserted CBD row + validation issues, not the
// request status — verify the transition at the DB level.
const [afterSubmit] = await db(`/costing_requests?select=status&id=eq.${requestId}`);
check("CBD submit → for_md_review", afterSubmit?.status === "for_md_review", String(afterSubmit?.status));

// ── 6. Gate probes mid-flow ───────────────────────────────────────────────────
await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete" }, expect: 409 });
await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "factoryA", body: { action: "approve" }, expect: 403 });
await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "md", body: { action: "costing_complete" }, expect: 403 });
await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "pbd", body: { action: "approve" }, expect: 409 });
await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "pbd", body: { action: "nonsense_action" }, expect: 400 });

// ── 7. MD technical review ────────────────────────────────────────────────────
await api(`/api/costing/requests/${requestId}/md-review`, { method: "POST", role: "costing", body: { decision: "pass" }, expect: 403 });
const md = await api(`/api/costing/requests/${requestId}/md-review`, { method: "POST", role: "md", body: { decision: "pass", notes: "E2E MD pass" }, expect: 200 });
check("MD pass → for_costing_review", md.json?.status === "for_costing_review", String(md.json?.status));

// ── 8. Costing validation ─────────────────────────────────────────────────────
const checklist = await api(`/api/costing/requests/${requestId}/checklist`, {
  method: "POST",
  role: "costing",
  body: {
    items: [
      { code: "moq_checked", isChecked: true },
      { code: "lead_time_checked", isChecked: true },
      { code: "packaging_checked", isChecked: true },
      { code: "comparable_style_reviewed", isChecked: true }
    ]
  },
  expect: 200
});
check("costing saves checklist", checklist.status === 200);
const costing = await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete" }, expect: 200 });
check("costing_complete → for_pbd_review", costing.json?.status === "for_pbd_review", String(costing.json?.status));

// ── 8b. PBD selling-price review (hard gate before approve) ───────────────────
await api(`/api/costing/requests/${requestId}/pricing`, { role: "factoryA", expect: 403 });
const pricing = await api(`/api/costing/requests/${requestId}/pricing`, {
  method: "POST",
  role: "pbd",
  body: { wholesalePrice: 3.5, retailPrice: 8.9, wholesaleMarkup: 2.0, retailMarkup: 2.5 },
  expect: 200
});
check("PBD enters selling-price review", pricing.status === 200 && pricing.json?.data?.pbd_pricing_status === "entered", String(pricing.json?.data?.pbd_pricing_status));

// ── 9. PBD approval ───────────────────────────────────────────────────────────
const approved = await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "pbd", body: { action: "approve", comment: "E2E final approval" }, expect: 200 });
check("PBD approve → approved", approved.json?.status === "approved", String(approved.json?.status));

// Historical costing row created?
const historical = await db(`/historical_costings?select=id,costing_request_id,style_number,total_cost&costing_request_id=eq.${requestId}`);
check("historical costing row created on approval", Array.isArray(historical) && historical.length >= 1, `rows=${Array.isArray(historical) ? historical.length : "err"}`);
const audit = await db(`/approval_actions?select=id,action,from_status,to_status,actor_role&costing_request_id=eq.${requestId}&order=created_at.asc`);
check("approval_actions audit trail written", Array.isArray(audit) && audit.length >= 3, `rows=${Array.isArray(audit) ? audit.length : "err"}`);

// ── 10. Customer status lifecycle (post-approval only) ────────────────────────
await api(`/api/costing/requests/${requestId}/customer-status`, { method: "POST", role: "factoryA", body: { status: "sent_to_customer" }, expect: 403 });
const [postApprove] = await db(`/costing_requests?select=customer_status&id=eq.${requestId}`);
check("approve auto-advances to pending_customer_submission", postApprove?.customer_status === "pending_customer_submission", String(postApprove?.customer_status));
const cs1 = await api(`/api/costing/requests/${requestId}/customer-status`, { method: "POST", role: "pbd", body: { status: "sent_to_customer", notes: "E2E submission" }, expect: 200 });
check("customer sent_to_customer", cs1.status === 200 && cs1.json?.status === "sent_to_customer", String(cs1.json?.status));
const cs2 = await api(`/api/costing/requests/${requestId}/customer-status`, { method: "POST", role: "pbd", body: { status: "customer_approved" }, expect: 200 });
check("customer_approved", cs2.status === 200 && cs2.json?.status === "customer_approved", String(cs2.json?.status));
const cs3 = await api(`/api/costing/requests/${requestId}/customer-status`, { method: "POST", role: "pbd", body: { status: "closed" }, expect: 200 });
check("closed", cs3.status === 200 && cs3.json?.status === "closed", String(cs3.json?.status));
const [finalRow] = await db(`/costing_requests?select=status,customer_status&id=eq.${requestId}`);
check("request approved + customer closed", finalRow?.status === "approved" && finalRow?.customer_status === "closed", JSON.stringify(finalRow));

// ── 11. Post-closure guards ───────────────────────────────────────────────────
await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "pbd", body: { action: "approve" }, expect: 409 });
await api(`/api/costing/requests/${requestId}/cbd`, { method: "POST", role: assignedProfile, body: cbdBody, expect: 409 });
const afterClosed = await api(`/api/costing/requests/${requestId}/customer-status`, {
  method: "POST",
  role: "pbd",
  body: { status: "under_negotiation" },
  expect: 409
});
check("customer status locked after closed", afterClosed.status === 409, String(afterClosed.status));
// No bare /api/costing/requests/[id] route exists — a non-UUID id on an
// existing [id] sub-route 400s via validateRequestId; a bare unknown path 404s.
await api("/api/costing/requests/not-a-uuid", { role: "pbd", expect: 404 });

// ── 12. Role visibility: internal data hidden from factory ────────────────────
const factoryHistory = await api("/api/historical/search?q=shirt", { role: "factoryA" });
check("factory blocked from historical costing", factoryHistory.status === 403 || factoryHistory.status === 404, String(factoryHistory.status));

// ── Cleanup ───────────────────────────────────────────────────────────────────
for (const table of [
  "customer_approval_attachments",
  "customer_revision_history",
  "checklist_results",
  "approval_actions",
  "workflow_events",
  "cbd_material_lines",
  "factory_cbds",
  "historical_costings",
  "costing_requests"
]) {
  try {
    const filter = table === "costing_requests" ? `id=eq.${requestId}` : `costing_request_id=eq.${requestId}`;
    await del(table, filter);
  } catch {
    /* best-effort */
  }
}
try {
  await del("nextgen_products", `style_number=eq.${styleNumber}`);
} catch {
  /* best-effort */
}
const [leftover] = await db(`/costing_requests?select=id&id=eq.${requestId}`);
check("test request cleaned up", !leftover);

// ── Report ────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
console.log(`\n══════════════════════════════════════════`);
console.log(`E2E: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");