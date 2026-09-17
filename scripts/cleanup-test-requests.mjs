// One-shot live cleanup: remove the leftover E2E request CR-691589 and the
// other unambiguous synthetic test requests from the live database.
//
// Safety rules encoded here:
//   - only requests on the explicit allowlist below are touched (reviewed by
//     hand from the live sweep) — nothing is inferred at runtime
//   - every row must be in an ACTIVE workflow status or `rejected`; if any row
//     has since moved to `approved` the run aborts, because an approved request
//     owns a historical costing row and must not be deleted
//   - children are deleted before the parent, then the deletion is verified
//
// Usage: node scripts/cleanup-test-requests.mjs [--apply]
//        node scripts/cleanup-test-requests.mjs --marker=E2E-FINAL-M88 [--apply]
//
// The `--marker` mode is what the live drivers' guard points at: it deletes
// every request carrying that marker in `notes`, whatever its status, which is
// the only way to clear rows a run created but died before it could track.

import { readFileSync } from "node:fs";
import { exitCleanly } from "./lib/driver-guard.mjs";

const APPLY = process.argv.includes("--apply");
const MARKER = (process.argv.find((arg) => arg.startsWith("--marker=")) ?? "").slice("--marker=".length).trim();

const ALLOWLIST = [
  "CR-691589", // the named target (e2e M8830037)
  // Import Factory smoke imports
  "CR-159855", "CR-044229", "CR-957567", "CR-752898",
  "CR-042838", // Destruct Factory
  "CR-929791", // clarify-flow test on M8836314
  "CR-555439", "CR-551215", // MD clarify / clarify tests
  "CR-578376", "CR-533103", // Debug Factory
  "CR-205684", "CR-114293", "CR-048526", // StepTest Factory
  "CR-098585", "CR-506147", "CR-473428", // Test Factory
  "CR-924925", "CR-545616" // rejected flow tests (no historical row)
];

const DELETABLE_STATUSES = new Set([
  "draft", "sent_to_factory", "needs_clarification",
  "for_md_review", "for_costing_review", "for_pbd_review", "rejected"
]);

const CHILD_TABLES = [
  "customer_approval_attachments", "customer_revision_history", "checklist_results",
  "cbd_change_requests", "request_comment_reads", "costing_notes", "compliance_checks",
  "validation_results", "outlier_reviews", "approval_actions", "workflow_events",
  "in_app_alerts", "notification_queue", "cbd_material_lines", "factory_cbds",
  "historical_costings"
];

const key = readFileSync(".env.local", "utf8").match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)[1].trim();
const HEADERS = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Accept-Profile": "tp_costing",
  "Content-Profile": "tp_costing"
};
const REST = "http://5.223.78.194:8000/rest/v1";

const get = async (path) => (await fetch(`${REST}${path}`, { headers: HEADERS })).json();
const remove = async (table, filter) => {
  const res = await fetch(`${REST}/${table}?${filter}`, { method: "DELETE", headers: { ...HEADERS, Prefer: "return=minimal" } });
  return res.status;
};

const list = ALLOWLIST.join(",");
const SELECT = "select=id,request_number,status,factory_name,nextgen_products(style_number)";
const rows = MARKER
  ? await get(`/costing_requests?${SELECT}&notes=ilike.*${encodeURIComponent(MARKER)}*&order=request_number`)
  : await get(`/costing_requests?${SELECT}&request_number=in.(${list})&order=request_number`);

if (!MARKER) {
  const found = new Set(rows.map((row) => row.request_number));
  const missing = ALLOWLIST.filter((number) => !found.has(number));
  if (missing.length) console.log(`note: already gone — ${missing.join(", ")}`);
}

const unsafe = rows.filter((row) => !DELETABLE_STATUSES.has(row.status));
if (unsafe.length && !MARKER) {
  console.error("ABORT — these rows are no longer deletable test artifacts:");
  for (const row of unsafe) console.error(`  ${row.request_number} is ${row.status}`);
  await exitCleanly(1);
}
// A marked leftover is deleted whatever its status — but never silently: an
// approved request owns a historical costing row, and deleting it takes that
// row with it (this is exactly how the cost library lost a row before).
if (unsafe.length) {
  console.warn("WARNING — these marked rows are past the deletable statuses:");
  for (const row of unsafe) console.warn(`  ${row.request_number} is ${row.status} — its historical costing row cascades with it`);
}

console.log(
  `\n${APPLY ? "DELETING" : "DRY RUN — would delete"} ${rows.length} request(s)` +
    `${MARKER ? ` marked ${MARKER}` : ""}:`
);
for (const row of rows) {
  console.log(`  ${row.request_number.padEnd(11)} ${String(row.status).padEnd(20)} ${String(row.factory_name ?? "-").padEnd(34)} ${row.nextgen_products?.style_number ?? ""}`);
}

if (!APPLY) {
  console.log("\nRe-run with --apply to delete.");
  await exitCleanly(0);
}

for (const row of rows) {
  for (const table of CHILD_TABLES) {
    await remove(table, `costing_request_id=eq.${row.id}`);
  }
  const status = await remove("costing_requests", `id=eq.${row.id}`);
  if (status >= 300) console.error(`  FAILED to delete ${row.request_number} (HTTP ${status})`);
}
console.log(`\nDeleted ${rows.length} request(s) with their child rows.`);

const remaining = MARKER
  ? await get(`/costing_requests?select=request_number,status&notes=ilike.*${encodeURIComponent(MARKER)}*`)
  : await get(`/costing_requests?select=request_number,status&request_number=in.(${list})`);
console.log(`Verified remaining${MARKER ? ` marked ${MARKER}` : " from this list"}: ${remaining.length ? JSON.stringify(remaining) : "none"}`);

const leftovers = await get("/costing_requests?select=request_number,status,factory_name&or=(factory_name.ilike.*E2E*,factory_name.ilike.*VERIFY*,factory_name.ilike.*Destruct*,factory_name.ilike.*StepTest*,factory_name.ilike.*Debug%20Factory*)&limit=20");
console.log(`E2E/VERIFY/Destruct/StepTest/Debug leftovers: ${leftovers.length ? JSON.stringify(leftovers) : "none"}`);
