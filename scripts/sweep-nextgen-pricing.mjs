// Sweeps every live request that still lacks NextGen pricing so the ERP
// figures are fetched and cached before the request reaches PBD review.
//
// Mechanism: the lazy fetch lives in the single owner
// (getNextGenPricingForRequest) and fires when the request detail page is
// read. So this script drives the REAL surface — it loads each unpriced
// request's page with an admin session, which fetches from NextGen and
// merges the cache back onto the snapshot — then re-reads the database to
// prove the figures actually landed.
//
// Read-only for the request itself; the only write is the intended pricing
// cache. ERP-unreachable styles stay unpriced and are reported honestly.
//
// Usage: node scripts/sweep-nextgen-pricing.mjs [baseUrl]
//   baseUrl defaults to http://localhost:3120 (dev server must be running).

import { readFileSync } from "node:fs";
import { mintCookie } from "./mint-cookie.mjs";

const BASE = process.argv[2] ?? "http://localhost:3120";

function loadEnvKey(name, files = [".env.local", ".env"]) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    if (match) return match[1].trim();
  }
  throw new Error(`${name} not found`);
}

import { existsSync } from "node:fs";
const SERVICE_KEY = loadEnvKey("SUPABASE_SERVICE_ROLE_KEY");
const PGREST = process.env.TP_PGREST_URL ?? "http://5.223.78.194:8000/rest/v1";
const H = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Accept-Profile": "tp_costing",
  "Content-Profile": "tp_costing"
};
const ADMIN_COOKIE = `tp_costing_session=${mintCookie({ sub: "00000000-0000-4000-8000-000000000001", name: "Sweep Admin", email: "sweep@test.local", role: "admin" })}`;

// Same positive-number rule as parseNextGenPrice in nextgen-pricing.ts.
function parsePrice(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Same precedence as nextGenPricingFromRaw: costing selling price first, then
// the target-max fallback.
function snapshotSellingPrice(raw) {
  if (!raw || typeof raw !== "object") return null;
  return (
    parsePrice(raw.DefaultProductCostingCostingSellingPrice) ??
    parsePrice(raw.TargetMaximumSellingPrice)
  );
}

async function pg(path) {
  const res = await fetch(`${PGREST}/${path}`, { headers: H });
  if (!res.ok) throw new Error(`PostgREST ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

// 1. Find active requests whose snapshot carries no selling price.
const ACTIVE = "draft,sent_to_factory,needs_clarification,for_md_review,for_costing_review,for_pbd_review";
const requests = await pg(
  `costing_requests?select=id,request_number,status,nextgen_products(id,nextgen_entity_id,style_number,raw_payload)&status=in.(${ACTIVE})`
);

const unpriced = [];
for (const r of requests) {
  const product = Array.isArray(r.nextgen_products) ? r.nextgen_products[0] : r.nextgen_products;
  if (!product) continue; // manual style — nothing to fetch, by design
  if (snapshotSellingPrice(product.raw_payload) !== null) continue;
  const entityId = String(product.nextgen_entity_id ?? "").trim();
  unpriced.push({ ...r, product, entityId, resolvable: entityId.length > 0 && !entityId.startsWith("manual:") });
}

console.log(`Active requests: ${requests.length} · unpriced with a NextGen product: ${unpriced.length}`);
for (const u of unpriced) {
  console.log(`  ${u.request_number} [${u.status}] entity=${u.product.nextgen_entity_id ?? "—"} (${u.resolvable ? "will fetch" : "NOT resolvable"})`);
}

// 2. Drive the real surface: a page read triggers the lazy fetch + cache.
let resolved = 0, stillUnpriced = 0;
for (const u of unpriced) {
  if (!u.resolvable) { stillUnpriced++; continue; }
  const res = await fetch(`${BASE}/requests/${u.id}`, {
    headers: { Cookie: ADMIN_COOKIE },
    redirect: "manual"
  });
  if (res.status !== 200) {
    console.log(`  ${u.request_number}: page returned ${res.status} — fetch not attempted`);
    stillUnpriced++;
    continue;
  }
  await res.text(); // drain the body so the server component fully renders
  // 3. Prove the cache landed by re-reading the snapshot.
  const [after] = await pg(`nextgen_products?id=eq.${u.product.id}&select=raw_payload`);
  const price = snapshotSellingPrice(after?.raw_payload);
  if (price !== null) {
    resolved++;
    const purchase = (() => {
      const raw = after.raw_payload ?? {};
      const v = Number(String(raw.DefaultProductCostingCostingPurchasePrice ?? raw.TargetMinimumPurchasePrice ?? "").replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(v) && v > 0 ? v : null;
    })();
    console.log(`  ${u.request_number}: CACHED selling=${price}${purchase !== null ? ` purchase=${purchase}` : ""}`);
  } else {
    stillUnpriced++;
    console.log(`  ${u.request_number}: ERP had no price (or unreachable) — snapshot unchanged`);
  }
}

console.log(`\nSweep complete: ${resolved} cached, ${stillUnpriced} still unpriced (ERP-unresolvable or ERP had no price).`);
console.log(`Note: the app retries the ERP at most once per entity per 5 minutes — re-run after that window to retry an ERP that was unreachable.`);
process.exitCode = 0;
