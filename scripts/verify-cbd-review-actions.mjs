// Live check: the CBD view ("View CBD") carries the reviewer's own decision
// controls, so checking a CBD and acting on it are the same screen — and, just
// as important, that each lane's controls appear only for the lane that owns
// them.
//
// Finds a live request in each review status and fetches /factory/<id> with each
// role's session. Read-only: creates nothing, changes nothing.
//
// Usage: node scripts/verify-cbd-review-actions.mjs [baseUrl]

import { existsSync, readFileSync } from "node:fs";
import { mintCookie } from "./mint-cookie.mjs";
import { exitCleanly } from "./lib/driver-guard.mjs";

const BASE = process.argv[2] ?? "http://localhost:3120";
const REST = "http://5.223.78.194:8000/rest/v1";

const PROFILES = {
  pbd: { sub: "3a7c8aba-8ce3-4555-8160-f78407b954ad", name: "PBD Test", email: "pbd@test.local" },
  costing: { sub: "ced47ce4-e9b0-4282-8369-6397d4b51952", name: "Costing Team", email: "tp.costing@madison88.com" },
  md: { sub: "597930cd-041d-409a-bb84-a97e1a225da0", name: "MD Test", email: "md@test.local" },
  factory: { sub: "a8258f6a-5a59-4229-b6c5-e230462261a2", name: "Factory A", email: "factory@test.local" }
};

function serviceKey() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
    if (match) return match[1].trim();
  }
  throw new Error("SUPABASE_SERVICE_ROLE_KEY not found");
}

const key = serviceKey();
const dbHeaders = { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "tp_costing" };
const cookieFor = (role) => `tp_costing_session=${mintCookie({ ...PROFILES[role], role })}`;

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const page = async (path, role) => {
  const response = await fetch(`${BASE}${path}`, { headers: { Cookie: cookieFor(role) }, redirect: "manual" });
  return { status: response.status, html: await response.text() };
};

const requestsIn = async (status) =>
  (
    await (
      await fetch(`${REST}/costing_requests?select=id,request_number,status&status=eq.${status}&order=request_number.desc&limit=1`, { headers: dbHeaders })
    ).json()
  )[0] ?? null;

// Each lane: what its own role must find on the CBD view, and which control
// belongs to a different lane and must not appear.
//
// Action buttons are matched on their closing markup, not on the bare word:
// the page embeds the NextGen BOM payload, which contains "Approved for Bulk"
// and friends, so a plain substring test reports controls that are not there.
const text = (needle) => ({ label: `“${needle}”`, test: (html) => html.includes(needle) });
const button = (label) => ({ label: `the ${label} button`, test: (html) => new RegExp(`${label}</button>`).test(html) });

const LANES = [
  {
    status: "for_md_review",
    role: "md",
    expects: [text("Merchandising gate"), text("Record MD Review"), text("Request factory clarification")],
    foreign: [text("Complete Validation"), text("Request Factory Correction"), button("Approve"), button("Reject")]
  },
  {
    status: "for_costing_review",
    role: "costing",
    expects: [text("Costing Team Validation Required"), text("Request Factory Clarification"), text("Complete Validation")],
    foreign: [text("Record MD Review"), text("Request Factory Correction"), button("Approve")]
  },
  {
    status: "for_pbd_review",
    role: "pbd",
    expects: [text("PBD Review"), text("Request Factory Correction"), button("Reject"), button("Approve")],
    foreign: [text("Record MD Review"), text("Complete Validation")]
  }
];

for (const lane of LANES) {
  const request = await requestsIn(lane.status);
  if (!request) {
    check(`${lane.status}: a live request exists to check`, false, "none in this status");
    continue;
  }
  const label = `${request.request_number} (${lane.status})`;

  const own = await page(`/factory/${request.id}`, lane.role);
  check(`${label}: CBD view loads for ${lane.role}`, own.status === 200, `status=${own.status}`);
  for (const expectation of lane.expects) {
    check(`${label}: ${lane.role} can act from the CBD view — ${expectation.label}`, expectation.test(own.html));
  }
  // Embedded in the CBD view, the action bar must not link back to itself.
  check(`${label}: no circular “View CBD” link on the CBD view`, !own.html.includes("View CBD"), "");

  for (const other of ["md", "costing", "pbd", "factory"]) {
    if (other === lane.role) continue;
    const html = (await page(`/factory/${request.id}`, other)).html;
    for (const expectation of lane.expects) {
      check(`${label}: ${other} cannot act from the CBD view — ${expectation.label} absent`, !expectation.test(html));
    }
    check(`${label}: ${other} sees no foreign-lane control`, !lane.foreign.some((expectation) => expectation.test(html)));
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${"═".repeat(46)}`);
console.log(`CBD REVIEW ACTIONS: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.name}`);
  await exitCleanly(1);
}
console.log("ALL CHECKS PASSED");
await exitCleanly(0);
