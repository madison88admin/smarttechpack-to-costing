// Final live end-to-end probe for the M88 (NextGen-ported) flow.
//
// Covers the four things the costing team asked for:
//   A. Creating a request for an M88* style with only a NextGen entity id
//      backfills the ERP selling / landed-cost figures — PBD types nothing.
//   B. A CBD revision keeps changes AND validation findings on one screen
//      (request detail findings panel + the CBD Revision Diff page).
//   C. Approval completes on the NextGen selling price alone (no manual
//      pricing entry) and still writes the historical costing row.
//   D. Like Styles reports how fast comparable styles run — average knitting
//      minutes per machine type, with the sample size behind it.
//
// Cleans up after itself: deletes every created row and restores the NextGen
// product snapshot it touched.
//
// Usage: node scripts/e2e-final-m88.mjs [baseUrl]
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
  target = resolveRestTarget({ usage: "node scripts/e2e-final-m88.mjs [baseUrl]" });
} catch (error) {
  console.error(`\n${error.message}\n`);
  await exitCleanly(3);
}

const BASE = process.argv[2] ?? "http://localhost:3120";
const STYLE = "M8830037";
const ENTITY_ID = "12688";
const FACTORY = "E2E FINAL FACTORY";

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

function loadEnvKey(name, files) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    if (match) return match[1].trim();
  }
  throw new Error(`${name} not found`);
}
const SERVICE_KEY = loadEnvKey("SUPABASE_SERVICE_ROLE_KEY", [".env.local", ".env"]);
const PGREST = target.rest;

// Every row this driver creates carries this marker in `notes`, so an
// interrupted run can always be found and removed — and so the guard can
// refuse to start while a previous run's rows are still there.
const MARKER = "E2E-FINAL-M88";
const DB_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Accept-Profile": "tp_costing",
  "Content-Profile": "tp_costing"
};

async function api(path, { method = "GET", role, body, expect } = {}) {
  const headers = {};
  if (role) headers.Cookie = cookie(role);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  const pass = expect === undefined || res.status === expect;
  console.log(`${pass ? "PASS" : "FAIL"}  ${method.padEnd(4)} ${(role ?? "anon").padEnd(8)} ${path.slice(0, 88)} → ${res.status}${expect !== undefined ? ` (expected ${expect})` : ""}`);
  if (!pass && json?.error) console.log(`       error: ${String(json.error).slice(0, 200)}`);
  return { status: res.status, json };
}

async function html(path, role) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie(role) }, redirect: "manual" });
  const text = await res.text();
  return { status: res.status, text };
}

async function db(path) {
  const res = await fetch(`${PGREST}${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Accept-Profile": "tp_costing" }
  });
  return res.json();
}
async function patch(table, filter, payload) {
  const res = await fetch(`${PGREST}/${table}?${filter}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", "Content-Profile": "tp_costing", Prefer: "return=minimal" },
    body: JSON.stringify(payload)
  });
  return res.status;
}
async function del(table, filter) {
  const res = await fetch(`${PGREST}/${table}?${filter}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Profile": "tp_costing", Prefer: "return=minimal" }
  });
  return res.status;
}

const results = [];
let failed = 0;
function check(name, pass, detail = "") {
  results.push({ name, pass });
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const parsePrice = (value) => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// Warnings-only payload: currency present (no error), but MOQ / lead time /
// buffer / packaging / testing / benchmark attributes omitted so the validation
// engine has something real to report.
const cbdBody = (styleNumber, overrides = {}) => ({
  status: "submitted",
  currency: "USD",
  styleNumber,
  styleName: "Final M88 probe",
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

const CHECKLIST = {
  items: [
    { code: "moq_checked", isChecked: true },
    { code: "lead_time_checked", isChecked: true },
    { code: "packaging_checked", isChecked: true },
    { code: "comparable_style_reviewed", isChecked: true }
  ]
};

const statusOf = async (id) => (await db(`/costing_requests?select=status,pbd_pricing_status&id=eq.${id}`))[0];

let run = null;

// Removes everything the run created. Called by the guard on every exit path
// (finish, crash, Ctrl+C, closed stdout), so it must be safe to run at any point.
async function cleanupRows(requestId) {
  if (!requestId) return;
  for (const table of [
    "customer_approval_attachments", "customer_revision_history", "checklist_results",
    "cbd_change_requests", "request_comment_reads", "costing_notes", "compliance_checks",
    "validation_results", "outlier_reviews", "approval_actions", "workflow_events",
    "in_app_alerts", "notification_queue", "cbd_material_lines", "factory_cbds",
    "historical_costings"
  ]) {
    try { await del(table, `costing_request_id=eq.${requestId}`); } catch { /* best-effort */ }
  }
  await del("costing_requests", `id=eq.${requestId}`);
}

async function restoreProductSnapshot(productSnapshot) {
  if (!productSnapshot) return 0;
  return patch("nextgen_products", `nextgen_entity_id=eq.${ENTITY_ID}`, {
    style_number: productSnapshot.style_number,
    name: productSnapshot.name,
    product_category: productSnapshot.product_category,
    raw_payload: productSnapshot.raw_payload
  });
}

async function main() {
  let requestId = null;
  let productSnapshot = null;

  // Refuses to run while a previous run's rows are still present, and takes
  // over cleanup for every exit path.
  run = await beginDriverRun({ name: "e2e-final-m88", marker: MARKER, rest: PGREST, headers: DB_HEADERS });
  console.log(`direct database: ${PGREST}${target.live ? "  (NON-LOCAL — TP_E2E_ALLOW_LIVE_DB=1 acknowledged)" : "  (local)"}`);
  run.track(() => cleanupRows(requestId));
  run.track(() => restoreProductSnapshot(productSnapshot));

  try {
    // ── Capture the NextGen product row so cleanup can restore it exactly ──
    const [before] = await db(`/nextgen_products?select=id,style_number,name,product_category,raw_payload&nextgen_entity_id=eq.${ENTITY_ID}`);
    productSnapshot = before ?? null;
    console.log(`\n── PART A: NextGen pricing auto-populate (${STYLE} / entity ${ENTITY_ID}) ──`);
    if (productSnapshot) {
      console.log(`     prior snapshot keys: ${Object.keys(productSnapshot.raw_payload ?? {}).join(", ") || "(none)"}`);
    }

    // 1. Create with the entity id only — no prices supplied by the caller.
    const created = await api("/api/costing/requests", {
      method: "POST",
      role: "pbd",
      body: {
        styleNumber: STYLE,
        nextgenEntityId: ENTITY_ID,
        productName: STYLE,
        productCategory: "Beanie",
        factoryName: FACTORY,
        season: "E2E",
        brand: "M88 PILOT",
        customer: "E2E Customer",
        notes: `final M88 pricing probe [${MARKER}]`,
        forceCreate: true
      },
      expect: 201
    });
    requestId = created.json?.data?.id;
    check("create for M88 style (entity id only)", Boolean(requestId), String(requestId));

    // 2. The stored snapshot must now carry ERP pricing.
    const [product] = await db(`/nextgen_products?select=raw_payload&nextgen_entity_id=eq.${ENTITY_ID}`);
    const raw = product?.raw_payload && typeof product.raw_payload === "object" ? product.raw_payload : {};
    const selling = parsePrice(raw.DefaultProductCostingCostingSellingPrice) ?? parsePrice(raw.TargetMaximumSellingPrice);
    const purchase = parsePrice(raw.DefaultProductCostingCostingPurchasePrice) ?? parsePrice(raw.TargetMinimumPurchasePrice);
    const currency = typeof raw.DefaultProductCostingCostingSellingCurrencyName === "string" ? raw.DefaultProductCostingCostingSellingCurrencyName : null;
    check("selling price backfilled from NextGen", selling !== null, `selling=${selling} purchase=${purchase} currency=${currency}`);
    check("landed-cost basis backfilled from NextGen", purchase !== null, `purchase=${purchase}`);
    if (selling !== null && purchase !== null) {
      check("margin is derivable (selling − landed)", selling - purchase !== 0, `${selling} − ${purchase} = ${(selling - purchase).toFixed(2)}`);
    }

    // 2a. The three figures the costing team reads off NextGen's Financial-FOB
    // panel: selling price, landed cost, margin — captured at creation.
    const landed = parsePrice(raw.CostingSheetValue4);
    const margin = parsePrice(raw.CostingSheetValue5 ?? undefined);
    check("landed cost ported from the ERP costing sheet", landed !== null, `CostingSheetValue4=${raw.CostingSheetValue4}`);
    check("margin ported from the ERP costing sheet", margin !== null, `CostingSheetValue5=${raw.CostingSheetValue5}`);
    check(
      "the ERP's own margin equals selling − landed",
      selling === null || landed === null || margin === null || Math.abs(selling - landed - margin) < 0.005,
      `${selling} − ${landed} = ${selling !== null && landed !== null ? (selling - landed).toFixed(2) : "?"} vs margin ${margin}`
    );

    // 2b. ERP-down simulation: strip the ported pricing back out of the snapshot,
    // the exact state 14 of 24 live NextGen-linked requests are in. The review
    // surface must resolve the figures through the pricing owner instead of
    // blocking PBD with "enter the selling price".
    await patch("nextgen_products", `nextgen_entity_id=eq.${ENTITY_ID}`, {
      raw_payload: { source: "nextgen", notes: null }
    });
    const [stripped] = await db(`/nextgen_products?select=raw_payload&nextgen_entity_id=eq.${ENTITY_ID}`);
    check("simulated a snapshot without ported pricing", !stripped?.raw_payload?.DefaultProductCostingCostingSellingPrice, JSON.stringify(stripped?.raw_payload));

    // The pricing panel lives in a client-rendered tab, so the server HTML only
    // proves the page rendered; the proof that the review surface resolved the
    // ERP price is the snapshot it cached back (asserted next).
    const lazyPage = await html(`/requests/${requestId}`, "pbd");
    check("review page renders for a snapshot without pricing", lazyPage.status === 200, `status=${lazyPage.status}`);

    const [cached] = await db(`/nextgen_products?select=raw_payload&nextgen_entity_id=eq.${ENTITY_ID}`);
    check(
      "lazy lookup cached the merge back onto the snapshot",
      Number(cached?.raw_payload?.DefaultProductCostingCostingSellingPrice) === selling && cached?.raw_payload?.source === "nextgen",
      `now=${cached?.raw_payload?.DefaultProductCostingCostingSellingPrice} source=${cached?.raw_payload?.source}`
    );

    // 3. Send to the factory, auto-assign, submit a CBD that raises warnings.
    await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "pbd", body: { action: "send_to_factory" }, expect: 200 });
    const [assigned] = await db(`/costing_requests?select=assigned_factory_user_id&id=eq.${requestId}`);
    const assignedRole = assigned?.assigned_factory_user_id === PROFILES.factory.sub ? "factory" : null;
    check("auto-assigned to a factory user", Boolean(assignedRole), String(assigned?.assigned_factory_user_id));
    const submit = await api(`/api/costing/requests/${requestId}/cbd`, { method: "POST", role: assignedRole ?? "factory", body: cbdBody(STYLE), expect: 201 });
    check("CBD submitted → for_md_review", (await statusOf(requestId))?.status === "for_md_review", String((await statusOf(requestId))?.status));

    console.log(`\n── PART B: Validation findings + revision diff in one view ──`);
    const findings = await db(`/validation_results?select=severity,rule_code,message,field_path&costing_request_id=eq.${requestId}`);
    const rows = Array.isArray(findings) ? findings : [];
    check("validation findings recorded for the submission", rows.length > 0, `${rows.length} finding(s): ${rows.slice(0, 3).map((r) => r.rule_code).join(", ")}`);

    const detailPage = await html(`/requests/${requestId}`, "pbd");
    check("request detail renders the findings panel", detailPage.status === 200 && detailPage.text.includes("Warnings &amp; highlights"), `status=${detailPage.status}`);
    check("findings panel names a real finding", rows.length === 0 || detailPage.text.includes(rows[0].message.slice(0, 40)), rows[0]?.message?.slice(0, 60) ?? "");

    // 4. Revision: reviewer asks for a change, factory resubmits with a new value.
    await api(`/api/costing/requests/${requestId}/md-review`, { method: "POST", role: "md", body: { decision: "needs_clarification", notes: "FINAL PROBE: labor rate low" }, expect: 200 });
    check("MD clarify → needs_clarification", (await statusOf(requestId))?.status === "needs_clarification", String((await statusOf(requestId))?.status));
    await api(`/api/costing/requests/${requestId}/cbd`, { method: "POST", role: assignedRole ?? "factory", body: cbdBody(STYLE, { laborCost: 0.72, notes: "FINAL PROBE: labor corrected" }), expect: 201 });
    check("factory resubmit → back to for_md_review", (await statusOf(requestId))?.status === "for_md_review", String((await statusOf(requestId))?.status));

    // The CBD view carries the lane's own decision controls, so a reviewer can
    // check the CBD and act on it without leaving the screen.
    const cbdViewMd = await html(`/factory/${requestId}`, "md");
    check("CBD view loads for MD", cbdViewMd.status === 200, `status=${cbdViewMd.status}`);
    check("MD can decide from inside the CBD view", cbdViewMd.text.includes("Record MD Review"), "");
    const cbdViewFactory = await html(`/factory/${requestId}`, "factory");
    check("factory sees no review control on the CBD view", !cbdViewFactory.text.includes("Record MD Review"), "");

    const diffPage = await html(`/requests/${requestId}/cbd-diff`, "pbd");
    check("CBD diff page renders the revision comparison", diffPage.status === 200 && /field\(s\) changed/.test(diffPage.text), `status=${diffPage.status}`);
    check("CBD diff page shows the changed field", /Labor cost|labour|labor/i.test(diffPage.text), "");
    check("CBD diff page shows validation findings too (consolidated)", diffPage.text.includes("Warnings &amp; highlights"), "changes + findings on one screen");

    console.log(`\n── PART C: Approve on the NextGen price (no manual pricing) ──`);
    await api(`/api/costing/requests/${requestId}/md-review`, { method: "POST", role: "md", body: { decision: "pass" }, expect: 200 });
    check("MD pass → for_costing_review", (await statusOf(requestId))?.status === "for_costing_review", String((await statusOf(requestId))?.status));
    await api(`/api/costing/requests/${requestId}/checklist`, { method: "POST", role: "costing", body: CHECKLIST, expect: 200 });
    await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete" }, expect: 200 });
    check("costing_complete → for_pbd_review", (await statusOf(requestId))?.status === "for_pbd_review", String((await statusOf(requestId))?.status));

    // PBD's decision, from the CBD view itself — the lane that owns the gate.
    const cbdViewPbd = await html(`/factory/${requestId}`, "pbd");
    check("PBD can approve or send back from inside the CBD view", cbdViewPbd.text.includes("Request Factory Correction") && /Approve<\/button>/.test(cbdViewPbd.text), "");
    const cbdViewCosting = await html(`/factory/${requestId}`, "costing");
    check("costing sees no PBD control on the CBD view", !cbdViewCosting.text.includes("Request Factory Correction"), "");

    const beforeApprove = await statusOf(requestId);
    check("PBD never entered manual pricing", beforeApprove?.pbd_pricing_status !== "entered", `pbd_pricing_status=${beforeApprove?.pbd_pricing_status}`);

    let approve = await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "pbd", body: { action: "approve", comment: "FINAL PROBE: approved on NextGen pricing" } });
    if (approve.status === 409 && /outlier/i.test(String(approve.json?.error ?? ""))) {
      console.log("     (outlier gate fired — acknowledging and retrying)");
      await api(`/api/costing/requests/${requestId}/outlier-acknowledgement`, { method: "POST", role: "costing", body: { justification: "FINAL PROBE outlier ack", flags: [] }, expect: 200 });
      approve = await api(`/api/costing/requests/${requestId}/actions`, { method: "POST", role: "pbd", body: { action: "approve", comment: "FINAL PROBE: approved on NextGen pricing" } });
    }
    check("PBD approve with no manual pricing → approved", approve.status === 200 && approve.json?.status === "approved", `${approve.status} ${String(approve.json?.status)}`);

    const historical = await db(`/historical_costings?select=id,total_cost&costing_request_id=eq.${requestId}`);
    check("historical costing row written on approval", Array.isArray(historical) && historical.length >= 1, `rows=${Array.isArray(historical) ? historical.length : "err"}`);

    console.log(`\n── PART D: Like Styles machine speed from history ──`);
    const likeStyles = await api(`/api/historical/like-styles?yarnType=Acrylic&limit=8`, { role: "pbd", expect: 200 });
    const matches = Array.isArray(likeStyles.json?.data) ? likeStyles.json.data : [];
    const speeds = Array.isArray(likeStyles.json?.benchmark?.machineSpeeds) ? likeStyles.json.benchmark.machineSpeeds : [];
    check("like styles returns comparable historical styles", matches.length > 0, `${matches.length} match(es)`);
    check("matches carry knitting minutes", matches.some((row) => typeof row.knitting_time === "number"), `knitting_time sample=${matches[0]?.knitting_time}`);
    check("machine speed table present", speeds.length > 0, speeds.slice(0, 3).map((s) => `${s.machineType} ${s.avgKnittingTime?.toFixed(1) ?? "—"}min (n=${s.sampleSize})`).join(" | "));
    check("fastest machine listed first", speeds.length < 2 || (speeds[0].avgKnittingTime <= speeds[1].avgKnittingTime && speeds.every((row, i) => i === 0 || (speeds[i - 1].avgKnittingTime ?? Infinity) <= (row.avgKnittingTime ?? Infinity))), "");
    // Every row states the sample behind its speed; a machine known only from
    // cost is listed last with no speed rather than dropped from the table.
    check("machine speed rows carry a sample size", speeds.every((row) => row.avgKnittingTime == null ? row.sampleSize === 0 : row.sampleSize > 0), `n=${speeds.map((s) => s.sampleSize).join(",")}`);
    check("machine rows state their cost sample", speeds.every((row) => typeof row.costSampleSize === "number"), `cost n=${speeds.map((s) => s.costSampleSize).join(",")}`);
    check(
      "machine cost average is expressed in a currency",
      speeds.every((row) => row.avgLandedCost == null || (typeof row.currency === "string" && row.currency.length === 3)),
      speeds.filter((s) => s.avgLandedCost != null).map((s) => `${s.machineType} ${s.currency} ${s.avgLandedCost.toFixed(2)} (n=${s.costSampleSize})`).join(" | ")
    );
    // Margin is only reported from real selling prices — never invented.
    check(
      "margin only appears where a real selling price exists",
      speeds.every((row) => (row.avgMargin == null ? row.marginSampleSize === 0 : row.marginSampleSize > 0)),
      `margin n=${speeds.map((s) => s.marginSampleSize).join(",")}`
    );

    const likeStylesPage = await html("/like-styles", "pbd");
    check("Like Styles page renders", likeStylesPage.status === 200, `status=${likeStylesPage.status}`);
  } finally {
    // ── Cleanup runs through the guard, so an interrupt gets the same treatment ──
    await run.finish();
    const [leftover] = await db(`/costing_requests?select=id&id=eq.${requestId ?? "00000000-0000-0000-0000-000000000000"}`);
    check("test request removed from the live database", !leftover);

    if (productSnapshot) {
      const [restored] = await db(`/nextgen_products?select=raw_payload&nextgen_entity_id=eq.${ENTITY_ID}`);
      check("NextGen product snapshot restored", JSON.stringify(restored?.raw_payload) === JSON.stringify(productSnapshot.raw_payload));
    }
    const marked = await run.leftovers();
    check("no marked rows left behind", marked.length === 0, `marker=${MARKER} rows=${marked.length}`);

    const passed = results.filter((r) => r.pass).length;
    console.log(`\n${"═".repeat(46)}`);
    console.log(`FINAL M88 E2E: ${passed}/${results.length} checks passed`);
    if (failed === 0) console.log("ALL CHECKS PASSED");
    else console.log(`${failed} FAILURE(S)`);
  }
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("driver crashed:", err);
  // Crash path still cleans up — a failed run must not leave rows behind.
  if (run) await run.finish();
  process.exit(1);
});
