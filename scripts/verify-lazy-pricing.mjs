// Behavioral verification of the lazy NextGen pricing resolution.
// Traces the full lifecycle against a running server + live database and
// asserts the state transitions, including the negative controls that must
// stay blocked (manual style, style the ERP has no price for). Cleans up every
// row it creates and restores any snapshot it touched.
//
// NOTE: run it in the foreground — piping it through `head`/`tail` kills the
// process early and leaks the test requests it created.
//
// Usage: node scripts/verify-lazy-pricing.mjs [baseUrl] [entityId] [styleNumber]
//
// The database it writes to is resolved, never inherited from the app's own
// configuration (which points at production here): TP_E2E_REST names it, the
// default is the local PostgREST, and a non-loopback target needs
// TP_E2E_ALLOW_LIVE_DB=1.

import { readFileSync, existsSync } from "node:fs";
import { mintCookie } from "./mint-cookie.mjs";
import { beginDriverRun, exitCleanly } from "./lib/driver-guard.mjs";
import { resolveRestTarget } from "./lib/rest-target.mjs";

// Refuse an unsafe database before anything else happens — before the service
// key is read, and long before a row is written.
let target;
try {
  target = resolveRestTarget({ usage: "node scripts/verify-lazy-pricing.mjs [baseUrl] [entityId] [styleNumber]" });
} catch (error) {
  console.error(`\n${error.message}\n`);
  await exitCleanly(3);
}

const BASE = process.argv[2] ?? "http://localhost:3120";
const REAL_ENTITY = process.argv[3] ?? "12992";
const REAL_STYLE = process.argv[4] ?? "M8836313";

const PROFILES = {
  pbd: { role: "pbd", sub: "3a7c8aba-8ce3-4555-8160-f78407b954ad", name: "PBD Test", email: "pbd@test.local" },
  factory: { role: "factory", sub: "a8258f6a-5a59-4229-b6c5-e230462261a2", name: "Factory A", email: "factory@test.local" },
  md: { role: "md", sub: "597930cd-041d-409a-bb84-a97e1a225da0", name: "MD Test", email: "md@test.local" },
  costing: { role: "costing", sub: "ced47ce4-e9b0-4282-8369-6397d4b51952", name: "Costing Team", email: "tp.costing@madison88.com" }
};
const cookie = (role) => {
  const p = PROFILES[role];
  return `tp_costing_session=${mintCookie({ sub: p.sub, name: p.name, email: p.email, role: p.role })}`;
};

function loadEnvKey(name) {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    if (match) return match[1].trim();
  }
  throw new Error(`${name} not found`);
}
const SERVICE_KEY = loadEnvKey("SUPABASE_SERVICE_ROLE_KEY");
const PGREST = target.rest;

async function db(path) {
  return (await fetch(`${PGREST}${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Accept-Profile": "tp_costing" } })).json();
}
async function patch(table, filter, payload) {
  return (await fetch(`${PGREST}/${table}?${filter}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", "Content-Profile": "tp_costing", Prefer: "return=minimal" },
    body: JSON.stringify(payload)
  })).status;
}
async function del(table, filter) {
  return (await fetch(`${PGREST}/${table}?${filter}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Profile": "tp_costing", Prefer: "return=minimal" }
  })).status;
}
async function api(path, { method = "GET", role, body } = {}) {
  const headers = {};
  if (role) headers.Cookie = cookie(role);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}
async function page(path, role) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie(role) }, redirect: "manual" });
  return { status: res.status, text: await res.text() };
}

let failed = 0;
const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const CBD = (styleNumber, overrides = {}) => ({
  status: "submitted",
  currency: "USD",
  styleNumber,
  styleName: "Lazy pricing verification",
  costedQty: "2000 pcs",
  finishWeight: "220 gsm",
  yarnLines: [
    { name: "Acrylic Yarn 32s", consumption: 0.21, materialPrice: 3.2, materialCost: 0.672 },
    { name: "Elastic", consumption: 0.04, materialPrice: 2.0, materialCost: 0.08 }
  ],
  knittingLines: [{ name: "Knitting", machineType: "Flat 12G", knittingTime: 11, knittingCost: 0.22 }],
  operationsLines: [{ name: "Cut & Sew", operation: "Making", sah: 7, knittingCost: 0.14 }],
  laborCost: 0.5,
  overheadCost: 0.1,
  profitCost: 0.2,
  ...overrides
});
const CHECKLIST = { items: ["moq_checked", "lead_time_checked", "packaging_checked", "comparable_style_reviewed"].map((code) => ({ code, isChecked: true })) };
const statusOf = async (id) => (await db(`/costing_requests?select=status,pbd_pricing_status&id=eq.${id}`))[0];
const snapshotOf = async (entityId) => (await db(`/nextgen_products?select=id,raw_payload&nextgen_entity_id=eq.${entityId}`))[0];
const sellingOf = (raw) => raw?.DefaultProductCostingCostingSellingPrice ?? raw?.TargetMaximumSellingPrice ?? null;

// Marks every row this driver creates, so an interrupted run is findable and
// the guard can refuse to start while a previous run's rows still exist.
const MARKER = "VERIFY-LAZY";
const DB_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Accept-Profile": "tp_costing",
  "Content-Profile": "tp_costing"
};
let run = null;
let beforeSnapshot = null;
const createdRequests = [];

async function createRequest(tag, extra) {
  const styleNumber = `VERIFY-${tag}-${Date.now()}`;
  const res = await api("/api/costing/requests", {
    method: "POST",
    role: "pbd",
    body: { styleNumber, productName: `Verify ${tag}`, factoryName: "VERIFY LAZY FACTORY", season: "VERIFY", brand: "VERIFY", customer: "VERIFY", notes: `lazy pricing verification [${MARKER}]`, forceCreate: true, ...extra }
  });
  const created = { id: res.json?.data?.id, styleNumber, status: res.status };
  if (created.id) createdRequests.push(created);
  return created;
}

async function driveToPbdReview(id, styleNumber) {
  const sent = await api(`/api/costing/requests/${id}/actions`, { method: "POST", role: "pbd", body: { action: "send_to_factory" } });
  const [row] = await db(`/costing_requests?select=assigned_factory_user_id&id=eq.${id}`);
  const factoryRole = row?.assigned_factory_user_id === PROFILES.factory.sub ? "factory" : null;
  const cbd = await api(`/api/costing/requests/${id}/cbd`, { method: "POST", role: factoryRole ?? "factory", body: CBD(styleNumber) });
  const md = await api(`/api/costing/requests/${id}/md-review`, { method: "POST", role: "md", body: { decision: "pass" } });
  await api(`/api/costing/requests/${id}/checklist`, { method: "POST", role: "costing", body: CHECKLIST });
  const costing = await api(`/api/costing/requests/${id}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete" } });
  return { sent: sent.status, cbd: cbd.status, md: md.status, costing: costing.status, factoryRole };
}

/** Deletes one request and its children; safe to call on any exit path. */
async function cleanup(id) {
  if (!id) return;
  for (const table of [
    "customer_approval_attachments", "customer_revision_history", "checklist_results",
    "cbd_change_requests", "request_comment_reads", "costing_notes", "compliance_checks",
    "validation_results", "outlier_reviews", "approval_actions", "workflow_events",
    "in_app_alerts", "notification_queue", "cbd_material_lines", "factory_cbds", "historical_costings"
  ]) {
    try { await del(table, `costing_request_id=eq.${id}`); } catch { /* best-effort */ }
  }
  await del("costing_requests", `id=eq.${id}`);
}

/** Puts a NextGen snapshot back exactly as it was before the run touched it. */
async function restoreSnapshot(entityId, rawPayload) {
  if (!entityId || rawPayload === undefined) return;
  const [row] = await db(`/nextgen_products?select=id&nextgen_entity_id=eq.${entityId}`);
  if (row?.id) await patch("nextgen_products", `id=eq.${row.id}`, { raw_payload: rawPayload });
}

async function main() {
  // Refuses to run over a previous run's leftovers; owns cleanup for every
  // exit path (finish, crash, Ctrl+C, closed stdout).
  run = await beginDriverRun({ name: "verify-lazy-pricing", marker: MARKER, rest: PGREST, headers: DB_HEADERS });
  console.log(`direct database: ${PGREST}${target.live ? "  (NON-LOCAL — TP_E2E_ALLOW_LIVE_DB=1 acknowledged)" : "  (local)"}`);
  run.track(async () => {
    for (const entry of createdRequests) await cleanup(entry.id);
  });
  run.track(() => restoreSnapshot(REAL_ENTITY, beforeSnapshot?.raw_payload ?? null));
  run.track(() => del("nextgen_products", "nextgen_entity_id=eq.999999999"));

  const before = await snapshotOf(REAL_ENTITY);
  beforeSnapshot = before;
  console.log(`\n── T1: live request whose snapshot has no pricing (entity ${REAL_ENTITY} / ${REAL_STYLE}) ──`);
  console.log(`     snapshot before: pricing=${sellingOf(before?.raw_payload) ?? "none"}`);

  const t1 = await createRequest("LAZY", { styleNumber: REAL_STYLE, nextgenEntityId: REAL_ENTITY, productName: REAL_STYLE, productCategory: "Headwear" });
  check("T1 request created", t1.status === 201 && Boolean(t1.id), `${t1.status} ${t1.id}`);

  // Simulate the ERP being unreachable at creation (the live state of 14/24
  // NextGen-linked requests): keep an unrelated key so the merge can be checked.
  await patch("nextgen_products", `nextgen_entity_id=eq.${REAL_ENTITY}`, {
    raw_payload: { source: "nextgen", notes: null, verifyMarker: "keep-me" }
  });
  const stripped = await snapshotOf(REAL_ENTITY);
  check("snapshot stripped to simulate an ERP-down creation", sellingOf(stripped?.raw_payload) === null, JSON.stringify(stripped?.raw_payload));

  const view1 = await page(`/requests/${t1.id}`, "pbd");
  check("review page renders without pricing", view1.status === 200, `status=${view1.status}`);
  const afterView = await snapshotOf(REAL_ENTITY);
  const afterRaw = afterView?.raw_payload ?? {};
  check("page read resolved the ERP price lazily", sellingOf(afterRaw) !== null, `selling=${sellingOf(afterRaw)}`);
  check("merge preserved the existing snapshot keys", afterRaw.verifyMarker === "keep-me" && afterRaw.source === "nextgen", JSON.stringify(afterRaw));
  check("lazy write landed on the same product row", afterView?.id === stripped?.id, `${afterView?.id} vs ${stripped?.id}`);

  const view2 = await page(`/requests/${t1.id}`, "pbd");
  const afterSecondView = await snapshotOf(REAL_ENTITY);
  check("second page read is stable (no thrash, no wipe)", view2.status === 200 && sellingOf(afterSecondView?.raw_payload) === sellingOf(afterRaw), `selling=${sellingOf(afterSecondView?.raw_payload)}`);

  console.log(`\n── T2: full lifecycle on the lazily-priced request ──`);
  const flow = await driveToPbdReview(t1.id, t1.styleNumber);
  check("send/CBD/MD/costing transitions all succeeded", flow.sent === 200 && flow.cbd === 201 && flow.md === 200 && flow.costing === 200, JSON.stringify(flow));
  const preApprove = await statusOf(t1.id);
  check("reached for_pbd_review with no manual pricing", preApprove?.status === "for_pbd_review" && preApprove?.pbd_pricing_status !== "entered", JSON.stringify(preApprove));

  let approve = await api(`/api/costing/requests/${t1.id}/actions`, { method: "POST", role: "pbd", body: { action: "approve", comment: "verify: approved on lazily resolved NextGen price" } });
  if (approve.status === 409 && /outlier/i.test(String(approve.json?.error ?? ""))) {
    await api(`/api/costing/requests/${t1.id}/outlier-acknowledgement`, { method: "POST", role: "costing", body: { justification: "verify ack", flags: [] } });
    approve = await api(`/api/costing/requests/${t1.id}/actions`, { method: "POST", role: "pbd", body: { action: "approve", comment: "verify: approved on lazily resolved NextGen price" } });
  }
  check("approval accepted the lazily resolved price", approve.status === 200 && approve.json?.status === "approved", `${approve.status} ${String(approve.json?.status)} ${String(approve.json?.error ?? "")}`);
  const historical = await db(`/historical_costings?select=id,costing_request_id&costing_request_id=eq.${t1.id}`);
  check("historical costing row written", Array.isArray(historical) && historical.length === 1, `rows=${Array.isArray(historical) ? historical.length : "err"}`);

  console.log(`\n── T3: negative control — manual style (no NextGen identity) must stay blocked ──`);
  const t3 = await createRequest("MANUAL");
  const manualSnapshot = await snapshotOf(`manual:${t3.styleNumber}`);
  check("manual style snapshot carries no pricing", t3.status === 201 && sellingOf(manualSnapshot?.raw_payload) === null, `selling=${sellingOf(manualSnapshot?.raw_payload)}`);
  const manualFlow = await driveToPbdReview(t3.id, t3.styleNumber);
  check("manual flow reached for_pbd_review", manualFlow.costing === 200 && (await statusOf(t3.id))?.status === "for_pbd_review", JSON.stringify(manualFlow));
  const blocked = await api(`/api/costing/requests/${t3.id}/actions`, { method: "POST", role: "pbd", body: { action: "approve" } });
  check("approval still BLOCKED without any NextGen price", blocked.status === 409 && /selling price/i.test(String(blocked.json?.error ?? "")), `${blocked.status} ${String(blocked.json?.error ?? "")}`);
  await api(`/api/costing/requests/${t3.id}/pricing`, { method: "POST", role: "pbd", body: { wholesalePrice: 3.5, retailPrice: 8.9, wholesaleMarkup: 2.0, retailMarkup: 2.5 } });
  let manualApprove = await api(`/api/costing/requests/${t3.id}/actions`, { method: "POST", role: "pbd", body: { action: "approve", comment: "verify manual price" } });
  if (manualApprove.status === 409 && /outlier/i.test(String(manualApprove.json?.error ?? ""))) {
    await api(`/api/costing/requests/${t3.id}/outlier-acknowledgement`, { method: "POST", role: "costing", body: { justification: "verify ack", flags: [] } });
    manualApprove = await api(`/api/costing/requests/${t3.id}/actions`, { method: "POST", role: "pbd", body: { action: "approve", comment: "verify manual price" } });
  }
  check("manual price entry still opens the gate", manualApprove.status === 200 && manualApprove.json?.status === "approved", `${manualApprove.status} ${String(manualApprove.json?.status)}`);

  console.log(`\n── T4: negative control — style the ERP has no price for ──`);
  const t4 = await createRequest("FAKE", { styleNumber: `VERIFY-FAKE-${Date.now()}`, nextgenEntityId: "999999999" });
  const fakeSnapshot = await snapshotOf("999999999");
  check("fake-entity snapshot has no pricing after creation", sellingOf(fakeSnapshot?.raw_payload) === null, JSON.stringify(fakeSnapshot?.raw_payload));
  const fakeView = await page(`/requests/${t4.id}`, "pbd");
  const fakeAfter = await snapshotOf("999999999");
  check("page read wrote nothing when the ERP had no price", fakeView.status === 200 && sellingOf(fakeAfter?.raw_payload) === null, `status=${fakeView.status} raw=${JSON.stringify(fakeAfter?.raw_payload)}`);
  const fakeFlow = await driveToPbdReview(t4.id, t4.styleNumber);
  const fakeBlocked = await api(`/api/costing/requests/${t4.id}/actions`, { method: "POST", role: "pbd", body: { action: "approve" } });
  check("approval blocked for a style with no ERP price", fakeFlow.costing === 200 && fakeBlocked.status === 409 && /selling price/i.test(String(fakeBlocked.json?.error ?? "")), `${fakeBlocked.status} ${String(fakeBlocked.json?.error ?? "")}`);

  console.log(`\n── cleanup ──`);
  // Run the tracked cleanups through the guard so the snapshot restore and the
  // child-row deletes follow the exact same path an interrupt would take.
  await run.finish();
  const [left1] = await db(`/costing_requests?select=id&id=eq.${t1.id}`);
  const [left3] = await db(`/costing_requests?select=id&id=eq.${t3.id}`);
  const [left4] = await db(`/costing_requests?select=id&id=eq.${t4.id}`);
  check("all three test requests deleted", !left1 && !left3 && !left4);
  const restored = await snapshotOf(REAL_ENTITY);
  check("entity snapshot restored to its prior state", JSON.stringify(restored?.raw_payload) === JSON.stringify(before?.raw_payload), JSON.stringify(restored?.raw_payload));
  await del("nextgen_products", "nextgen_entity_id=eq.999999999");
  const [fakeLeft] = await db(`/nextgen_products?select=id&nextgen_entity_id=eq.999999999`);
  check("fake product row deleted", !fakeLeft);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${"═".repeat(46)}`);
  console.log(`LAZY PRICING VERIFICATION: ${passed}/${results.length} checks passed`);
  if (failed === 0) console.log("ALL BEHAVIOR ASSERTIONS PASSED");
  else console.log(`${failed} FAILURE(S)`);
}

main().catch(async (err) => {
  console.error("verification crashed:", err);
  // Crash path still cleans up — a failed run must not leave rows behind.
  if (run) await run.finish();
  process.exit(1);
}).then(() => { if (failed > 0) process.exit(1); });
