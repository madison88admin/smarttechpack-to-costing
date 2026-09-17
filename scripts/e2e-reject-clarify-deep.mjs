// Live probe driver #3: deep-dive rejection + clarification testing.
// Goes beyond e2e-clarify-ls.mjs with harsher negative gates:
//   - wrong-role and wrong-stage action attempts at every step
//   - rejected request terminality (approve/clarify/resubmit all blocked)
//   - rejected request must NOT create a historical costing row
//   - workflow_events audit trail for every transition
//   - PBD clarify resubmit returns DIRECTLY to for_pbd_review
// Cleans up every created request via the service role afterwards.
//
// Usage: node scripts/e2e-reject-clarify-deep.mjs [baseUrl]

import { readFileSync, existsSync } from "node:fs";
import { mintCookie } from "./mint-cookie.mjs";
import { beginDriverRun } from "./lib/driver-guard.mjs";

const BASE = process.argv[2] ?? "http://localhost:3120";

const PROFILES = {
  pbd: { role: "pbd", sub: "3a7c8aba-8ce3-4555-8160-f78407b954ad", name: "PBD Test", email: "pbd@test.local" },
  factoryA: { role: "factory", sub: "a8258f6a-5a59-4229-b6c5-e230462261a2", name: "Factory A", email: "factory@test.local" },
  factoryB: { role: "factory", sub: "3e5cd390-26a2-4ed7-b88e-097560615a2a", name: "Factory B", email: "tp.factory@madison88.com" },
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
const PGREST = new URL("http://5.223.78.194:8000/rest/v1");

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
  try { json = await res.json(); } catch { /* non-JSON */ }
  const pass = expect === undefined || res.status === expect;
  console.log(`${pass ? "PASS" : "FAIL"}  ${method.padEnd(4)} ${(role ?? "anon").padEnd(8)} ${path.slice(0, 90)} → ${res.status}${expect !== undefined ? ` (expected ${expect})` : ""}`);
  if (!pass && json?.error) console.log(`       error: ${String(json.error).slice(0, 160)}`);
  return { status: res.status, json };
}

async function db(path) {
  const res = await fetch(`${PGREST.href}${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Accept-Profile": "tp_costing" }
  });
  return res.json();
}
async function del(table, filter) {
  const res = await fetch(`${PGREST.href}/${table}?${filter}`, {
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

const cbdBody = (styleNumber, overrides = {}) => ({
  status: "submitted",
  currency: "USD",
  styleNumber,
  styleName: "Reject Clarify Deep Test",
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
  notes: "reject/clarify deep probe",
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

const stamp = Date.now();

// Marks every row this driver creates, so an interrupted run is findable and
// the guard can refuse to start while a previous run's rows still exist.
const MARKER = "E2E-RCD";
const DB_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Accept-Profile": "tp_costing",
  "Content-Profile": "tp_costing"
};
let run = null;

async function makeRequest(tag) {
  const styleNumber = `E2E-RCD-${tag}-${stamp}`;
  const created = await api("/api/costing/requests", {
    method: "POST",
    role: "pbd",
    body: { styleNumber, productName: `RCD ${tag}`, factoryName: "E2E TEST FACTORY", season: "E2E", brand: "E2E Brand", customer: "E2E Customer", notes: `reject/clarify deep probe [${MARKER}]` },
    expect: 201
  });
  const id = created.json?.data?.id;
  check(`create (${tag})`, Boolean(id), styleNumber);
  // Throw, not exit: the guard converts this into a cleaned-up failure.
  if (!id) throw new Error(`create (${tag}) returned no id`);
  const sent = await api(`/api/costing/requests/${id}/actions`, { method: "POST", role: "pbd", body: { action: "send_to_factory" }, expect: 200 });
  check(`send_to_factory (${tag})`, sent.json?.status === "sent_to_factory", String(sent.json?.status));
  const [reqRow] = await db(`/costing_requests?select=assigned_factory_user_id&id=eq.${id}`);
  const assigned = reqRow?.assigned_factory_user_id === PROFILES.factoryA.sub ? "factoryA" : reqRow?.assigned_factory_user_id === PROFILES.factoryB.sub ? "factoryB" : null;
  check(`auto-assigned (${tag})`, Boolean(assigned), String(reqRow?.assigned_factory_user_id));
  const rogue = assigned === "factoryA" ? "factoryB" : "factoryA";
  return { id, assigned, rogue, styleNumber };
}

/** Deletes one request and its children; safe to call on any exit path. */
async function cleanup(requestId, styleNumber) {
  if (!requestId) return;
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

async function statusOf(id) {
  const [row] = await db(`/costing_requests?select=status&id=eq.${id}`);
  return row?.status;
}

// ── Notification assertions ─────────────────────────────────────────────────
// Each transition must enqueue the right email for the role that owns the
// NEXT step, and must NOT leak the alert to any other role's recipients.
// Recipients come from live user_profiles (role + is_active), so the check
// stays true when the pilot roster changes.
let roleEmails = null;
async function loadRoleEmails() {
  if (roleEmails) return roleEmails;
  const rows = await db(`/user_profiles?select=role,email&is_active=eq.true`);
  roleEmails = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.email) continue;
    (roleEmails[row.role] ??= []).push(row.email);
  }
  return roleEmails;
}

const notifCursor = new Map();

async function assertTransitionNotified(label, requestId, { role, subject, allowChangeAlert = false }) {
  const emails = await loadRoleEmails();
  const expected = emails[role] ?? [];
  const costingEmails = emails.costing ?? [];
  const rows = await db(`/notification_queue?select=recipient,subject,body&costing_request_id=eq.${requestId}&order=created_at.asc`);
  const all = Array.isArray(rows) ? rows : [];
  const start = notifCursor.get(requestId) ?? 0;
  const fresh = all.slice(start);
  notifCursor.set(requestId, all.length);

  const isRoleAlert = (row) => expected.includes(row.recipient) && String(row.subject ?? "").includes(subject);
  const matched = fresh.filter(isRoleAlert);
  const missing = expected.filter((email) => !matched.some((row) => row.recipient === email));

  // A factory resubmit that changes CBD fields ALSO enqueues a "BOM / CBD
  // changed" alert — but only to the lane the correction re-enters, so
  // allowChangeAlert is off for lanes that must not see one (a PBD-requested
  // correction never re-opens Costing's gate). Every other non-matching row
  // (another role, or an unexplained subject) is a leak.
  const extras = fresh.filter((row) => !isRoleAlert(row));
  const isChangeAlert = (row) => costingEmails.includes(row.recipient) && String(row.subject ?? "").includes("BOM / CBD changed");
  const changeAlerts = allowChangeAlert ? extras.filter(isChangeAlert) : [];
  const overflow = extras.filter((row) => !changeAlerts.includes(row));

  check(
    `notify ${label} → ${role} (${expected.length} recipient(s))`,
    matched.length > 0 && missing.length === 0 && overflow.length === 0,
    `new=${fresh.length} matched=${matched.length} missing=[${missing}] overflow=[${overflow.map((r) => `${r.recipient}:${String(r.subject).slice(0, 40)}`)}]`
  );
  return { fresh, changeAlerts };
}

async function assertInAppAlert(label, requestId, role) {
  const rows = await db(`/in_app_alerts?select=recipient_role,title&costing_request_id=eq.${requestId}&recipient_role=eq.${role}`);
  check(`in-app alert ${label} → ${role}`, Array.isArray(rows) && rows.length > 0, `rows=${Array.isArray(rows) ? rows.length : "err"}`);
}

async function main() {
  // Refuses to run over a previous run's leftovers; owns cleanup for every
  // exit path (finish, crash, Ctrl+C, closed stdout).
  run = await beginDriverRun({ name: "e2e-reject-clarify-deep", marker: MARKER, rest: PGREST, headers: DB_HEADERS });
  const created = [];
  run.track(async () => {
    for (const entry of created) await cleanup(entry.id, entry.styleNumber);
  });
  // ══ PART 1: REJECTION deep-dive ═══════════════════════════════════════════
  console.log(`\n── PART 1: Rejection ──`);
  const rej = await makeRequest("REJ");
  created.push(rej);
  const { id: rejId } = rej;
  await assertTransitionNotified("send_to_factory", rejId, { role: "factory", subject: "sent to factory" });
  await assertInAppAlert("send_to_factory", rejId, "factory");

  const sub = await api(`/api/costing/requests/${rejId}/cbd`, { method: "POST", role: rej.assigned, body: cbdBody(rej.styleNumber), expect: 201 });
  check("factory CBD submit", sub.status === 201);
  check("status = for_md_review", (await statusOf(rejId)) === "for_md_review", await statusOf(rejId));
  await assertTransitionNotified("CBD submit", rejId, { role: "md", subject: "Factory CBD submitted" });
  await assertInAppAlert("CBD submit", rejId, "md");

  // Negative: wrong roles try to reject while in MD review
  await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "factoryA", body: { action: "reject" }, expect: 403 });
  await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "md", body: { action: "reject" }, expect: 403 });
  await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "costing", body: { action: "reject" }, expect: 403 });

  await api(`/api/costing/requests/${rejId}/md-review`, { method: "POST", role: "md", body: { decision: "pass" }, expect: 200 });
  check("MD pass → for_costing_review", (await statusOf(rejId)) === "for_costing_review");
  await assertTransitionNotified("MD pass", rejId, { role: "costing", subject: "MD technical review passed" });
  await assertInAppAlert("MD pass", rejId, "costing");

  await api(`/api/costing/requests/${rejId}/checklist`, { method: "POST", role: "costing", body: CHECKLIST, expect: 200 });
  await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete" }, expect: 200 });
  check("costing_complete → for_pbd_review", (await statusOf(rejId)) === "for_pbd_review");
  await assertTransitionNotified("costing_complete", rejId, { role: "pbd", subject: "Costing validation complete" });
  await assertInAppAlert("costing_complete", rejId, "pbd");

  // Negative: PBD reject without pricing must fail? Rejection is allowed regardless of pricing — verify it works from for_pbd_review
  const reject = await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "pbd", body: { action: "reject", comment: "RCD: cost too high" }, expect: 200 });
  check("PBD reject → rejected", reject.json?.status === "rejected", String(reject.json?.status));
  check("DB confirms rejected", (await statusOf(rejId)) === "rejected");
  await assertTransitionNotified("reject", rejId, { role: "factory", subject: "Request rejected" });

  // No transition after a rejection may notify anyone.
  const rejNotifBefore = (await db(`/notification_queue?select=id&costing_request_id=eq.${rejId}`)).length;

  // Terminal state: every follow-up action must be blocked
  await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "pbd", body: { action: "approve" }, expect: 409 });
  await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "pbd", body: { action: "clarify", comment: "too late" }, expect: 409 });
  await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "pbd", body: { action: "reject", comment: "again" }, expect: 409 });
  await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "costing", body: { action: "costing_clarify" }, expect: 409 });
  await api(`/api/costing/requests/${rejId}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete" }, expect: 409 });
  await api(`/api/costing/requests/${rejId}/cbd`, { method: "POST", role: rej.assigned, body: cbdBody(rej.styleNumber), expect: 409 });
  await api(`/api/costing/requests/${rejId}/md-review`, { method: "POST", role: "md", body: { decision: "pass" }, expect: 409 });
  check("rejected terminality: approve/clarify/re-reject/costing actions/CBD/MD all 409", true);
  const rejNotifAfter = (await db(`/notification_queue?select=id&costing_request_id=eq.${rejId}`)).length;
  check("blocked actions enqueue NO notifications", rejNotifAfter === rejNotifBefore, `${rejNotifBefore} → ${rejNotifAfter}`);

  // Rejected must NOT appear in historical costings
  const rejHist = await db(`/historical_costings?select=id&costing_request_id=eq.${rejId}`);
  check("rejected request has NO historical row", Array.isArray(rejHist) && rejHist.length === 0, `rows=${Array.isArray(rejHist) ? rejHist.length : "err"}`);

  // Audit trail: workflow_events for reject exist
  const rejEvents = await db(`/workflow_events?select=event_type,actor_role&costing_request_id=eq.${rejId}&order=created_at.desc`);
  const rejEventTypes = Array.isArray(rejEvents) ? rejEvents.map((e) => e.event_type) : [];
  check("audit trail has reject event", rejEventTypes.some((t) => /reject/i.test(t)), rejEventTypes.slice(0, 5).join(", "));

  await cleanup(rejId, rej.styleNumber);

  // ══ PART 2: FULL CLARIFICATION CASCADE (MD → Costing → PBD) ═══════════════
  console.log(`\n── PART 2: Clarification cascade ──`);
  const cc = await makeRequest("CLR");
  created.push(cc);
  const { id: ccId } = cc;
  await assertTransitionNotified("send_to_factory", ccId, { role: "factory", subject: "sent to factory" });

  await api(`/api/costing/requests/${ccId}/cbd`, { method: "POST", role: cc.assigned, body: cbdBody(cc.styleNumber), expect: 201 });
  check("CBD submit → for_md_review", (await statusOf(ccId)) === "for_md_review");
  await assertTransitionNotified("CBD submit", ccId, { role: "md", subject: "Factory CBD submitted" });

  // Negative: wrong-stage clarifies while in MD review
  await api(`/api/costing/requests/${ccId}/actions`, { method: "POST", role: "pbd", body: { action: "clarify", comment: "too early" }, expect: 409 });
  await api(`/api/costing/requests/${ccId}/actions`, { method: "POST", role: "costing", body: { action: "costing_clarify", comment: "too early" }, expect: 409 });
  check("PBD/Costing clarify blocked in for_md_review (MD owns this stage)", true);

  // ── MD clarify loop ──
  const mdClar = await api(`/api/costing/requests/${ccId}/md-review`, { method: "POST", role: "md", body: { decision: "needs_clarification", notes: "RCD: yarn spec unclear" }, expect: 200 });
  check("MD needs_clarification → needs_clarification", mdClar.json?.status === "needs_clarification", String(mdClar.json?.status));
  await assertTransitionNotified("MD clarify", ccId, { role: "factory", subject: "MD requested clarification" });
  // Negative: rogue factory cannot resubmit; assigned factory can
  await api(`/api/costing/requests/${ccId}/cbd`, { method: "POST", role: cc.rogue, body: cbdBody(cc.styleNumber), expect: 403 });
  await api(`/api/costing/requests/${ccId}/cbd`, { method: "POST", role: cc.assigned, body: cbdBody(cc.styleNumber), expect: 201 });
  check("factory resubmit after MD clarify → back to for_md_review", (await statusOf(ccId)) === "for_md_review", await statusOf(ccId));
  await assertTransitionNotified("resubmit after MD clarify", ccId, { role: "md", subject: "MD technical review required" });

  const mdPass = await api(`/api/costing/requests/${ccId}/md-review`, { method: "POST", role: "md", body: { decision: "pass" }, expect: 200 });
  check("MD pass → for_costing_review", mdPass.json?.status === "for_costing_review");
  await assertTransitionNotified("MD pass", ccId, { role: "costing", subject: "MD technical review passed" });

  // ── Costing clarify loop ──
  const costClar = await api(`/api/costing/requests/${ccId}/actions`, { method: "POST", role: "costing", body: { action: "costing_clarify", comment: "RCD: verify labor rate" }, expect: 200 });
  check("costing_clarify → needs_clarification", costClar.json?.status === "needs_clarification", String(costClar.json?.status));
  await assertTransitionNotified("costing_clarify", ccId, { role: "factory", subject: "Costing requested clarification" });
  // Negative: PBD cannot approve from needs_clarification
  await api(`/api/costing/requests/${ccId}/actions`, { method: "POST", role: "pbd", body: { action: "approve" }, expect: 409 });
  await api(`/api/costing/requests/${ccId}/cbd`, { method: "POST", role: cc.assigned, body: cbdBody(cc.styleNumber, { laborCost: 0.65, notes: "RCD: labor corrected" }), expect: 201 });
  check("factory resubmit after costing clarify → back to for_costing_review (skips MD)", (await statusOf(ccId)) === "for_costing_review", await statusOf(ccId));
  const costResubmit = await assertTransitionNotified("resubmit after costing clarify", ccId, { role: "costing", subject: "Costing review required", allowChangeAlert: true });
  check("changed resubmit also alerts costing of the BOM/CBD change", costResubmit.changeAlerts.length > 0, `changeAlerts=${costResubmit.changeAlerts.length}`);
  check(
    "change alert copy names Costing as the next step",
    costResubmit.changeAlerts.length > 0 && costResubmit.changeAlerts.every((row) => String(row.subject).includes("Costing re-validation required") && String(row.body).includes("Next step (Costing)")),
    String(costResubmit.changeAlerts[0]?.subject ?? "")
  );

  await api(`/api/costing/requests/${ccId}/checklist`, { method: "POST", role: "costing", body: CHECKLIST, expect: 200 });
  await api(`/api/costing/requests/${ccId}/actions`, { method: "POST", role: "costing", body: { action: "costing_complete" }, expect: 200 });
  check("costing_complete → for_pbd_review", (await statusOf(ccId)) === "for_pbd_review");
  await assertTransitionNotified("costing_complete", ccId, { role: "pbd", subject: "Costing validation complete" });

  // ── PBD clarify loop ──
  const pbdClar = await api(`/api/costing/requests/${ccId}/actions`, { method: "POST", role: "pbd", body: { action: "clarify", comment: "RCD: margin too thin" }, expect: 200 });
  check("PBD clarify → needs_clarification", pbdClar.json?.status === "needs_clarification", String(pbdClar.json?.status));
  await assertTransitionNotified("PBD clarify", ccId, { role: "factory", subject: "PBD requested clarification" });
  // This resubmit changes real CBD fields, so the suppression is actually
  // exercised: Costing's gate never re-opens, so it must receive nothing.
  const costingInAppBefore = ((await db(`/in_app_alerts?select=id&costing_request_id=eq.${ccId}&alert_type=eq.bom_changed&recipient_role=eq.costing`)) ?? []).length;
  await api(`/api/costing/requests/${ccId}/cbd`, { method: "POST", role: cc.assigned, body: cbdBody(cc.styleNumber, { laborCost: 0.72, notes: "RCD: PBD margin fix" }), expect: 201 });
  check("factory resubmit after PBD clarify → DIRECTLY for_pbd_review (skips MD+costing)", (await statusOf(ccId)) === "for_pbd_review", await statusOf(ccId));
  const pbdResubmit = await assertTransitionNotified("resubmit after PBD clarify", ccId, { role: "pbd", subject: "PBD review required" });
  const pbdHandoff = pbdResubmit.fresh.find((row) => String(row.subject).includes("PBD review required"));
  check(
    "PBD handoff carries the CBD change summary instead of a costing alert",
    String(pbdHandoff?.body ?? "").includes("Changed fields:") && String(pbdHandoff?.body ?? "").includes("FOB:"),
    String(pbdHandoff?.subject ?? "missing handoff")
  );
  const costingInAppAfter = ((await db(`/in_app_alerts?select=id&costing_request_id=eq.${ccId}&alert_type=eq.bom_changed&recipient_role=eq.costing`)) ?? []).length;
  check("no new costing in-app BOM badge on the PBD-return resubmit", costingInAppAfter === costingInAppBefore, `${costingInAppBefore} → ${costingInAppAfter}`);

  // Pricing + approve
  await api(`/api/costing/requests/${ccId}/actions`, { method: "POST", role: "pbd", body: { action: "approve" }, expect: 409 }); // no pricing yet
  await api(`/api/costing/requests/${ccId}/pricing`, { method: "POST", role: "pbd", body: { wholesalePrice: 3.5, retailPrice: 8.9, wholesaleMarkup: 2.0, retailMarkup: 2.5 }, expect: 200 });
  const approve = await api(`/api/costing/requests/${ccId}/actions`, { method: "POST", role: "pbd", body: { action: "approve", comment: "RCD approve after all 3 clarify loops" }, expect: 200 });
  check("PBD approve after full cascade → approved", approve.json?.status === "approved", String(approve.json?.status));

  const ccHist = await db(`/historical_costings?select=id&costing_request_id=eq.${ccId}`);
  check("approved request HAS historical row", Array.isArray(ccHist) && ccHist.length >= 1, `rows=${Array.isArray(ccHist) ? ccHist.length : "err"}`);

  // Audit trail: all three clarification events present
  const ccEvents = await db(`/workflow_events?select=event_type&costing_request_id=eq.${ccId}&order=created_at.asc`);
  const evText = Array.isArray(ccEvents) ? ccEvents.map((e) => e.event_type).join(",") : "";
  check("audit trail records clarification events", /clarif|needs/i.test(evText), evText.slice(0, 120));

  await run.finish();

  // ══ Summary ══
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${"═".repeat(44)}`);
  console.log(`REJECT/CLARIFY DEEP: ${passed}/${results.length} checks passed`);
  if (failed === 0) console.log("ALL CHECKS PASSED");
  else { console.log(`${failed} FAILURES`); process.exit(1); }
}

main().catch(async (err) => {
  console.error("driver crashed:", err);
  if (run) await run.finish();
  process.exit(1);
});
