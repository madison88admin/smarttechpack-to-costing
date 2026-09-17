// Creates a retained, clearly labelled CBD revision example for user training.
// It intentionally stops at PBD Review so MD, Costing, and PBD can all open
// the request and inspect the real side-by-side change history.
//
// Usage: node scripts/seed-revision-demo.mjs [baseUrl]

import { mintCookie } from "./mint-cookie.mjs";

const BASE = process.argv[2] ?? "http://localhost:3120";
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const styleNumber = `DEMO-REV-${stamp}`;

const profiles = {
  pbd: { role: "pbd", sub: "3a7c8aba-8ce3-4555-8160-f78407b954ad", name: "PBD Demo Reviewer", email: "pbd@test.local" },
  md: { role: "md", sub: "597930cd-041d-409a-bb84-a97e1a225da0", name: "MD Demo Reviewer", email: "md@test.local" },
  costing: { role: "costing", sub: "ced47ce4-e9b0-4282-8369-6397d4b51952", name: "Costing Demo Reviewer", email: "tp.costing@madison88.com" },
  factoryA: { role: "factory", sub: "a8258f6a-5a59-4229-b6c5-e230462261a2", name: "Factory Demo User", email: "factory@test.local" },
  factoryB: { role: "factory", sub: "3e5cd390-26a2-4ed7-b88e-097560615a2", name: "Factory Demo Backup", email: "tp.factory@madison88.com" }
};

function cookie(role) {
  const profile = profiles[role];
  return `tp_costing_session=${mintCookie(profile)}`;
}

async function call(path, { role, method = "GET", body, expected = 200 } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(role ? { Cookie: cookie(role) } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const json = await response.json().catch(() => ({}));
  if (response.status !== expected) {
    throw new Error(`${method} ${path} returned ${response.status}; expected ${expected}. ${json.error ?? ""}`.trim());
  }
  return json;
}

function cbd(overrides = {}) {
  return {
    status: "submitted",
    currency: "USD",
    styleNumber,
    styleName: "Revision Review Demonstration",
    costedQty: "5,000 pcs",
    finishWeight: "180 gsm",
    yarnType: "Recycled Acrylic 32s",
    knitType: "Rib",
    machineType: "Flat 12G",
    construction: "1x1 Rib Beanie",
    productCategory: "Headwear",
    yarnLines: [{ name: "Recycled acrylic 32s", consumption: 0.22, materialPrice: 3.2, materialCost: 0.704 }],
    knittingLines: [{ name: "Knitting", machineType: "Flat 12G", knittingTime: 12, knittingCost: 0.24 }],
    operationsLines: [{ name: "Linking", operation: "Linking", sah: 8, knittingCost: 0.16 }],
    standardPackagingCost: 0.12,
    specialPackagingCost: 0.05,
    laborCost: 0.5,
    overheadCost: 0.1,
    profitCost: 0.2,
    notes: "DEMO: Initial Factory CBD for revision-review training.",
    ...overrides
  };
}

const checklist = {
  items: [
    { code: "moq_checked", isChecked: true },
    { code: "lead_time_checked", isChecked: true },
    { code: "packaging_checked", isChecked: true },
    { code: "comparable_style_reviewed", isChecked: true }
  ]
};

async function submitCbd(requestId, payload) {
  for (const role of ["factoryA", "factoryB"]) {
    const response = await fetch(`${BASE}/api/costing/requests/${requestId}/cbd`, {
      method: "POST",
      headers: { Cookie: cookie(role), "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (response.status === 201) return role;
    if (response.status !== 403) throw new Error(`Factory CBD submission returned ${response.status}. ${json.error ?? ""}`.trim());
  }
  throw new Error("No active demo factory profile is assigned to the request.");
}

async function main() {
  const created = await call("/api/costing/requests", {
    role: "pbd",
    method: "POST",
    expected: 201,
    body: {
      styleNumber,
      productName: "Revision Review Demonstration",
      factoryName: "Revision Demo Factory",
      season: "DEMO-2026",
      brand: "Smart TP Training",
      customer: "Internal Training",
      productCategory: "Headwear",
      notes: "DEMO DATA — use this request to review MD, Costing, and PBD change requests with actual CBD revisions."
    }
  });
  const requestId = created.data?.id;
  if (!requestId) throw new Error("Demo request was not created.");

  await call(`/api/costing/requests/${requestId}/actions`, { role: "pbd", method: "POST", body: { action: "send_to_factory" } });
  const factoryRole = await submitCbd(requestId, cbd());

  await call(`/api/costing/requests/${requestId}/md-review`, {
    role: "md", method: "POST",
    body: { decision: "needs_clarification", notes: "MD change request: sample construction needs Flat 7G, not Flat 12G. Update the Machine / Gauge Type in Knitting & Operations." }
  });
  await call(`/api/costing/requests/${requestId}/cbd`, {
    role: factoryRole, method: "POST", expected: 201,
    body: cbd({
      machineType: "Flat 7G",
      knittingLines: [{ name: "Knitting", machineType: "Flat 7G", knittingTime: 12, knittingCost: 0.24 }],
      notes: "DEMO revision 1: Changed machine gauge from Flat 12G to Flat 7G per MD review."
    })
  });
  await call(`/api/costing/requests/${requestId}/md-review`, { role: "md", method: "POST", body: { decision: "pass", notes: "MD verified the 7G machine matches the sample construction." } });
  await call(`/api/costing/requests/${requestId}/checklist`, { role: "costing", method: "POST", body: checklist });
  await call(`/api/costing/requests/${requestId}/actions`, {
    role: "costing", method: "POST",
    body: { action: "costing_clarify", comment: "Costing change request: labor is below the agreed operation rate. Update Labor Cost from USD 0.50 to USD 0.65 and Packaging from USD 0.12 to USD 0.18." }
  });
  await call(`/api/costing/requests/${requestId}/cbd`, {
    role: factoryRole, method: "POST", expected: 201,
    body: cbd({
      machineType: "Flat 7G",
      knittingLines: [{ name: "Knitting", machineType: "Flat 7G", knittingTime: 12, knittingCost: 0.24 }],
      laborCost: 0.65,
      standardPackagingCost: 0.18,
      notes: "DEMO revision 2: Updated labor and standard packaging following Costing validation."
    })
  });
  await call(`/api/costing/requests/${requestId}/actions`, { role: "costing", method: "POST", body: { action: "costing_complete" } });
  await call(`/api/costing/requests/${requestId}/actions`, {
    role: "pbd", method: "POST",
    body: { action: "clarify", comment: "PBD change request: please update profit from USD 0.20 to USD 0.24 to align with the approved selling-price margin." }
  });
  await call(`/api/costing/requests/${requestId}/cbd`, {
    role: factoryRole, method: "POST", expected: 201,
    body: cbd({
      machineType: "Flat 7G",
      knittingLines: [{ name: "Knitting", machineType: "Flat 7G", knittingTime: 12, knittingCost: 0.24 }],
      laborCost: 0.65,
      standardPackagingCost: 0.18,
      profitCost: 0.24,
      notes: "DEMO revision 3: Updated profit after PBD margin review."
    })
  });

  console.log(JSON.stringify({ ok: true, requestId, styleNumber, status: "for_pbd_review", diffUrl: `${BASE}/requests/${requestId}/cbd-diff` }));
}

await main();
