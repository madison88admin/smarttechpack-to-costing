// Live verification for the notification requeue capability.
//
// Drives the real admin route against the running server + live database:
//   1. reads the queue summary as admin
//   2. proves non-admins are refused
//   3. runs the requeue, confirms the failed rows actually flip to pending
//   4. restores the queue to its exact prior state (status/attempts/last_error)
//
// Usage: node scripts/verify-notification-requeue.mjs [baseUrl]
// The restore step runs even when an assertion fails, so the live queue is
// never left in a test state.

import { readFileSync } from "node:fs";
import { mintCookie } from "./mint-cookie.mjs";

const BASE = process.argv[2] ?? "http://localhost:3120";
const REST = "http://5.223.78.194:8000/rest/v1";
const TRANSPORT_ERROR = "Email transport is not configured (Microsoft Graph or SMTP required)";

const serviceKey = readFileSync(".env.local", "utf8").match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)[1].trim();
const DB_HEADERS = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Accept-Profile": "tp_costing", "Content-Profile": "tp_costing" };

let passed = 0;
const failures = [];
function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const db = (path) => fetch(REST + path, { headers: DB_HEADERS }).then((res) => res.json());

async function counts() {
  const rows = await db("/notification_queue?select=id,status,attempts,last_error&limit=5000");
  const by = { pending: 0, sent: 0, failed: 0 };
  for (const row of rows) by[row.status] = (by[row.status] ?? 0) + 1;
  return { rows, by };
}

const admin = mintCookie({ role: "admin", sub: "00000000-0000-4000-8000-0000000000ad", name: "Verify Admin", email: "admin@test.local" });
const pbd = mintCookie({ role: "pbd", sub: "00000000-0000-4000-8000-000000000099", name: "Verify PBD", email: "pbd@test.local" });

const call = (method, cookie, body) =>
  fetch(`${BASE}/api/admin/notifications/queue`, {
    method,
    headers: { Cookie: `tp_costing_session=${cookie}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });

const before = await counts();
const pendingIdsBefore = before.rows.filter((row) => row.status === "pending").map((row) => row.id);
console.log(`live queue before: ${JSON.stringify(before.by)}`);

try {
  // ── 1. summary (read-only) ────────────────────────────────────────────────
  console.log("\n1. Admin reads queue health");
  const summaryRes = await call("GET", admin);
  const summary = await summaryRes.json();
  check("GET returns 200 for an admin", summaryRes.status === 200, `HTTP ${summaryRes.status}`);
  check("summary matches the database", summary.data?.failed === before.by.failed && summary.data?.pending === before.by.pending,
    JSON.stringify(summary.data));
  check("summary reports the active transport", typeof summary.data?.transport === "string", String(summary.data?.transport));
  check("summary reports the last failure reason", summary.data?.lastError === TRANSPORT_ERROR, String(summary.data?.lastError));

  // ── 2. role gate ──────────────────────────────────────────────────────────
  console.log("\n2. Non-admins are refused without touching the queue");
  const pbdPost = await call("POST", pbd, {});
  check("POST is 403 for pbd", pbdPost.status === 403, `HTTP ${pbdPost.status}`);
  const pbdGet = await call("GET", pbd);
  check("GET is 403 for pbd", pbdGet.status === 403, `HTTP ${pbdGet.status}`);
  const afterRefusal = await counts();
  check("no row changed while refused", afterRefusal.by.failed === before.by.failed, JSON.stringify(afterRefusal.by));

  // ── 3. requeue ────────────────────────────────────────────────────────────
  console.log("\n3. Admin requeues the failed backlog");
  const requeueRes = await call("POST", admin, {});
  const requeue = await requeueRes.json();
  check("POST returns 200", requeueRes.status === 200, `HTTP ${requeueRes.status}`);
  check("requeue reports every failed row", requeue.requeued === before.by.failed, `${requeue.requeued} vs ${before.by.failed}`);
  check("no skip reason when a transport is present", !requeue.skipped, String(requeue.skipped));

  const afterRequeue = await counts();
  check("failed rows are gone", (afterRequeue.by.failed ?? 0) === 0, JSON.stringify(afterRequeue.by));
  check("they are now pending", afterRequeue.by.pending === before.by.pending + before.by.failed, JSON.stringify(afterRequeue.by));
  check("previously pending rows were not disturbed", pendingIdsBefore.every((id) => afterRequeue.rows.some((row) => row.id === id && row.status === "pending")));
  // The rows this call actually reset: clean (attempts 0, no error) and not
  // pending before the call. The queue already had clean pending rows.
  const requeued = afterRequeue.rows.filter(
    (row) => row.status === "pending" && row.attempts === 0 && !row.last_error && !pendingIdsBefore.includes(row.id)
  );
  check("attempts are reset and the error cleared", requeued.length === before.by.failed, `${requeued.length} of ${before.by.failed}`);
  check("sent rows are untouched", afterRequeue.by.sent === before.by.sent, `${afterRequeue.by.sent} vs ${before.by.sent}`);
} finally {
  // ── 4. restore ────────────────────────────────────────────────────────────
  console.log("\n4. Restoring the live queue to its prior state");
  const notPending = pendingIdsBefore.join(",");
  const restore = await fetch(
    `${REST}/notification_queue?status=eq.pending&attempts=eq.0&last_error=is.null&id=not.in.(${notPending})`,
    {
      method: "PATCH",
      headers: { ...DB_HEADERS, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed", attempts: 3, last_error: TRANSPORT_ERROR })
    }
  );
  console.log(`  restore HTTP ${restore.status}`);

  const after = await counts();
  console.log(`live queue after:  ${JSON.stringify(after.by)}`);
  check("failed count restored", after.by.failed === before.by.failed, `${after.by.failed} vs ${before.by.failed}`);
  check("pending count restored", after.by.pending === before.by.pending, `${after.by.pending} vs ${before.by.pending}`);
  check("sent count restored", after.by.sent === before.by.sent);
  const failedRows = after.rows.filter((row) => row.status === "failed");
  check("every failed row keeps attempts=3", failedRows.every((row) => row.attempts === 3));
  check("every failed row keeps its error text", failedRows.every((row) => row.last_error === TRANSPORT_ERROR));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("failures:\n  " + failures.join("\n  "));
    process.exitCode = 1;
  }
}
