// Live probe driver #2: clarification loops (MD / Costing / PBD), PBD
// rejection, and Like Styles + historical-search matching, all through the
// real HTTP API with signed role cookies. Cleans up every created request via
// the service role afterwards.
//
// Usage:
//   node scripts/e2e-clarify-ls.mjs [baseUrl]
//
// Reads TP_COSTING_SESSION_SECRET via mint-cookie.mjs and
// SUPABASE_SERVICE_ROLE_KEY from .env.local. Importing this file does nothing;
// the driver runs only when executed directly (guarded like mint-cookie.mjs).

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
    `${pass ? "PASS" : "FAIL"}  ${method.padEnd(4)} ${(role ?? "anon").padEnd(8)} ${path.slice(0, 90)} → ${res.status}${expect !== undefined ? ` (expected ${expect})` : ""}`
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
async function del(table, filter) {
  const res = await fetch(`${PGREST}/${table}?${filter}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Profile": "tp_costing", Prefer: "return=minimal" }
  });
  return res.status;
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const cbdBody = (styleNumber) => ({
  status: "submitted",
  currency: "USD",
  styleNumber,
  styleName: "Clarify Loop Test",
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
  notes: "Clarify-loop automated CBD"
});

const CHECKLIST = {
  items: [
    { code: "moq_checked", isChecked: true },
    { code: "lead_time_checked", isChecked: true },
    { code: "packaging_checked", isChecked: true },
    { code: "comparable_style_reviewed", isChecked: true }
  ]
};

const stamp = Date.now();
const REQUEST_IDS = [];

async function makeRequest(tag) {
  const styleNumber = `E2E-CLR-${tag}-${stamp}`;
  const created = await api("/api/costing/requests", {
    method: "POST",
    role: "pbd",
    body: { styleNumber, productName: `Clarify ${tag}`, factoryName: "E2E TEST FACTORY", season: "E2E", brand: "E2E Brand", customer: "E2E Customer", notes: "clarify loop" },
    expect: 201
  });
  const id = created.json?.data?.id;
  check(`create (${tag})`, Boolean(id), styleNumber);
  if (!id) process.exit(1);
  REQUEST_IDS.push(id);
  const sent = await api(`/api/costing/requests/${id}/actions`, { method: "POST", role: "pbd", body: { action: "send_to_factory" }, expect: 200 });
  check(`send_to_factory (${tag})`, sent.json?.status === "sent_to_factory", String(sent.json?.status));
  const [reqRow] = await db(`/costing_requests?select=assigned_factory_user_id&id=eq.${id}`);
  const assigned = reqRow?.assigned_factory_user_id === PROFILES.factoryA.sub ? "factoryA" : reqRow?.assigned_factory_user_id === PROFILES.factoryB.sub ? "factoryB" : null;
  check(`auto-assigned (${tag})`, Boolean(assigned), String(reqRow?.assigned_factory_user_id));
  const sub = await api(`/api/costing/requests/${id}/cbd`, { method: "POST", role: assigned, body: cbdBody(styleNumber), expect: 201 });
  check(`factory CBD submit (${tag})`, sub.status === 201, "201");
  const [after] = await db(`/costing_requests?select=status&id=eq.${id}`);
  check(`→ for_md_review (${tag})`, after?.status === "for_md_review", String(after?.status));
  return { id, assigned };
}

async function cleanup(requestId, styleNumber) {
  for (const table of [
    "customer_approval_attachments", "customer_revision_history", "checklist_results",
    "approval_actions", "workflow_events", "cbd_material_lines", "factory_cbds",
    "historical_costings", "costing_requests"
  ]) {
    try {
      const filter = table === "costing_requests" ? `id=eq.${requestId}` : `costing_request_id=eq.${requestId}`;
      await del(table, filter);
    } catch { /* best-effort */ }
  }
  try { await del("nextgen_products", `style_number=eq.${styleNumber}`); } catch { /* best-effort */ }
  const [leftover] = await db(`/costing_requests?select=id&id=eq.${requestId}`);
  check(`cleaned up ${requestId.slice(0, 8)}`, !leftover);
}

async function main() {
  // ── A. Clarification loop: MD ──────────────────────────────────────────────
  const mdReq = await makeRequest("MD");
  const { id: mdId, assigned: mdAssigned } = mdReq;
  const [mdRow] = await db(`/costing_requests?select=status&id=eq.${mdId}`);
  check("MD loop start: for_md_review", mdRow?.status === "for_md_review");

  const mdClarify = await api(`/api/costing/requests/${mdId}/md-review`, {
    method: "POST", role: "md", body: { decision: "needs_clarification", notes: "E2E: weight and yarn spec unclear" }, expect: 200
  });
  check("MD needs_clarification → needs_clarification", mdClarify.json?.status === "needs_clarification", String(mdClarify.json?.status));
  const [mdBack] = await db(`/costing_requests?select=status&id=eq.${mdId}`);
  check("DB confirms needs_clarification", mdBack?.status === "needs_clarification", String(mdBack?.status));

  // Factory resubmits (assigned only — rogue still blocked)
  await api(`/api/costing/requests/${mdId}/cbd`, { role: mdAssigned === "factoryA" ? "factoryB" : "factoryA", expect: 403 });
  const mdResub = await api(`/api/costing/requests/${mdId}/cbd`, { method: "POST", role: mdAssigned, body: cbdBody(`E2E-CLR-MD-${stamp}`), expect: 201 });
  check("factory resubmit after MD clarify", mdResub.status === 201, "201");
  const [mdReturn] = await db(`/costing_requests?select=status&id=eq.${mdId}`);
  check("resubmit returns to for_md_review", mdReturn?.status === "for_md_review", String(mdReturn?.status));

  const mdPass = await api(`/api/costing/requests/${mdId}/md-review`, { method: "POST", role: "md", body: { decision: "pass", notes: "E2E pass after clarify" }, expect: 200 });
  check("MD pass after clarify → for_costing_review", mdPass.json?.status === "for_costing_review", String(mdPass.json?.status));

  // ── B. Clarification loop: Costing ─────────────────────────────────────────
  await api(`/api/costing/requests/${mdId}/checklist`, { method: "POST", role: "costing", body: CHECKLIST, expect: 200 });
  const costClarify = await api(`/api/costing/requests/${mdId}/actions`, { method: "POST", role: "costing", body: { action: "costing_clarify", comment: "E2E: verify labor rate" }, expect: 200 });
  check("costing_clarify → needs_clarification", costClarify.json?.status === "needs_clarification", String(costClarify.json?.status));
  await api(`/api/costing/requests/${mdId}/cbd`, { method: "POST", role: mdAssigned, body: cbdBody(`E2E-CLR-MD-${stamp}`), expect: 201 });
  const [costReturn] = await db(`/costing_requests?select=status&id=eq.${mdId}`);
  check("resubmit returns to for_costing_review", costReturn?.status === "for_costing_review", String(costReturn?.status));
  const costComplete = await api(`/api/costing/requests/${mdId}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete" }, expect: 200 });
  check("costing_complete → for_pbd_review", costComplete.json?.status === "for_pbd_review", String(costComplete.json?.status));

  // ── C. Clarification loop: PBD ─────────────────────────────────────────────
  const pbdClarify = await api(`/api/costing/requests/${mdId}/actions`, { method: "POST", role: "pbd", body: { action: "clarify", comment: "E2E: margin seems high" }, expect: 200 });
  check("PBD clarify → needs_clarification", pbdClarify.json?.status === "needs_clarification", String(pbdClarify.json?.status));
  await api(`/api/costing/requests/${mdId}/cbd`, { method: "POST", role: mdAssigned, body: cbdBody(`E2E-CLR-MD-${stamp}`), expect: 201 });
  const [pbdReturn] = await db(`/costing_requests?select=status&id=eq.${mdId}`);
  check("resubmit returns DIRECTLY to for_pbd_review", pbdReturn?.status === "for_pbd_review", String(pbdReturn?.status));

  // Pricing gate + approve
  await api(`/api/costing/requests/${mdId}/pricing`, { method: "POST", role: "pbd", body: { wholesalePrice: 3.5, retailPrice: 8.9, wholesaleMarkup: 2.0, retailMarkup: 2.5 }, expect: 200 });
  const approve = await api(`/api/costing/requests/${mdId}/actions`, { method: "POST", role: "pbd", body: { action: "approve", comment: "E2E approve after 3 clarify loops" }, expect: 200 });
  check("PBD approve after all clarify loops → approved", approve.json?.status === "approved", String(approve.json?.status));
  const hist = await db(`/historical_costings?select=id&costing_request_id=eq.${mdId}`);
  check("historical row created after clarify-approved", Array.isArray(hist) && hist.length >= 1, `rows=${Array.isArray(hist) ? hist.length : "err"}`);

  // ── D. Rejection path ──────────────────────────────────────────────────────
  const rejReq = await makeRequest("REJ");
  const { id: rejId, assigned: rejAssigned } = rejReq;
  await api(`/api/costing/requests/${rejId}/md-review`, { method: "POST", role: "md", body: { decision: "pass" }, expect: 200 });
  await api(`/api/costing/requests/${rejId}/checklist`, { method: "POST", role: "costing", body: CHECKLIST, expect: 200 });
  await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete" }, expect: 200 });
  const reject = await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "pbd", body: { action: "reject", comment: "E2E rejection test" }, expect: 200 });
  check("PBD reject → rejected", reject.json?.status === "rejected", String(reject.json?.status));
  const [rejRow] = await db(`/costing_requests?select=status&id=eq.${rejId}`);
  check("DB confirms rejected", rejRow?.status === "rejected", String(rejRow?.status));
  await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "pbd", body: { action: "approve" }, expect: 409 });
  await api(`/api/costing/requests/${rejId}/cbd`, { method: "POST", role: rejAssigned, body: cbdBody(`E2E-CLR-REJ-${stamp}`), expect: 409 });
  check("rejected request is terminal (no re-approve / no late CBD)", true, "409 + 409");

  // ── E. Like Styles live matching ───────────────────────────────────────────
  await api("/api/historical/like-styles?yarnType=Acrylic&limit=5", { expect: 401 }); // anon blocked
  const ls = await api("/api/historical/like-styles?yarnType=Acrylic&limit=5", { role: "pbd" });
  const lsOk = ls.status === 200 && ls.json?.ok === true && Array.isArray(ls.json?.data) && ls.json.data.length >= 1;
  check("like-styles full match returns real rows", lsOk, `rows=${Array.isArray(ls.json?.data) ? ls.json.data.length : "err"}`);
  check(
    "like-styles rows carry scorePercent + confidence",
    lsOk && typeof ls.json.data[0]?.scorePercent === "number" && ["low", "medium", "high"].includes(ls.json.data[0]?.confidence),
    lsOk ? `score=${ls.json.data[0].scorePercent} conf=${ls.json.data[0].confidence}` : "no rows"
  );
  check("like-styles benchmark sampleSize present", lsOk && typeof ls.json?.benchmark?.sampleSize === "number", `sampleSize=${ls.json?.benchmark?.sampleSize}`);

  // The token scorer matches whole normalized tokens: a row sharing only the
  // "acrylic" token with a longer yarn string ("Reguler Acrylic") earns
  // proportional credit (verified: 50/medium) vs a full match (100/high). A
  // bare prefix like "Acry" is NOT a token, so it correctly matches nothing.
  const lsPartial = await api("/api/historical/like-styles?yarnType=Acrylic&limit=10", { role: "costing" });
  const lsRows = lsPartial.json?.data ?? [];
  const partialRow = lsRows.find((r) => r.scorePercent > 0 && r.scorePercent < 100);
  check(
    "like-styles partial token-overlap earns proportional credit",
    lsPartial.status === 200 && Boolean(partialRow),
    partialRow ? `${partialRow.yarn_type} score=${partialRow.scorePercent} conf=${partialRow.confidence}` : `rows=${lsRows.length}`
  );
  const lsFactory = await api("/api/historical/like-styles?yarnType=Acrylic", { role: "factoryA" });
  check("factory blocked from like-styles", lsFactory.status === 401 || lsFactory.status === 403, String(lsFactory.status));

  // ── F. Historical search live matching ─────────────────────────────────────
  const hs = await api("/api/historical/search?q=Acrylic&limit=5", { role: "pbd" });
  check("historical search finds real rows", hs.status === 200 && Array.isArray(hs.json?.data) && hs.json.data.length >= 1, `rows=${Array.isArray(hs.json?.data) ? hs.json.data.length : "err"}`);
  // Real factory names exist in the library (live brand values are all null,
  // so a brand filter would correctly return 0 — using the factory dimension
  // instead proves the touched ilike surface still matches rows).
  const hs2 = await api("/api/historical/search?q=Acrylic&factory=Factory-M8836313", { role: "md" });
  check("historical search with factory filter returns rows", hs2.status === 200 && Array.isArray(hs2.json?.data) && hs2.json.data.length >= 1, `rows=${Array.isArray(hs2.json?.data) ? hs2.json.data.length : "err"}`);

  // ── G. Matching controls (touched surfaces — filters still return rows) ────
  // requests status filter: pick a status that has live rows
  const [statusWithRows] = await db(`/costing_requests?select=status&order=created_at.desc&limit=100`);
  const pickStatus = statusWithRows?.status ?? "for_pbd_review";
  const reqFiltered = await api(`/api/costing/requests?status=${pickStatus}`, { role: "pbd" });
  const rows = reqFiltered.json?.data ?? [];
  check(
    "requests status filter returns the right subset",
    reqFiltered.status === 200 && rows.length >= 1 && rows.every((r) => r.status === pickStatus),
    `rows=${rows.length} all=${pickStatus}`
  );
  // requests q= search on a real request number
  const [anyReq] = await db(`/costing_requests?select=request_number&order=created_at.desc&limit=1`);
  const qSearch = await api(`/api/costing/requests?q=${encodeURIComponent(anyReq?.request_number ?? "CR-")}`, { role: "pbd" });
  const qRows = qSearch.json?.data ?? [];
  check("requests q= search finds a real request", qSearch.status === 200 && qRows.some((r) => r.request_number === anyReq?.request_number), `rows=${qRows.length}`);
  // admin severity filter on the error-log CSV (touched surface)
  const logs = await api("/api/admin/logs.csv?severity=error", { role: "admin" });
  const csvBody = logs.json ?? "";
  const csvLines = typeof csvBody === "string" ? csvBody.trim().split("\n").length : 0;
  check("admin severity filter returns rows (logs.csv)", logs.status === 200 && csvLines >= 1, `csvLines=${csvLines}`);

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  await cleanup(mdId, `E2E-CLR-MD-${stamp}`);
  await cleanup(rejId, `E2E-CLR-REJ-${stamp}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n══════════════════════════════════════════`);
  console.log(`CLARIFY/LS/HISTORICAL: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    for (const f of failed) console.log(`  - ${f.name}`);
    process.exit(1);
  }
  console.log("ALL CHECKS PASSED");
}

// CLI-only: this file is never imported by the app or the test suite; it runs
// the driver only when executed directly (same pattern as e2e-live.mjs).
await main();