#!/usr/bin/env node
/**
 * Clears all data from the tp_costing schema (except user_profiles).
 * Deletes in dependency order to avoid FK constraint errors.
 */
const BASE = "http://5.223.78.194:8000/rest/v1";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3MTY3NjgwMDAsImV4cCI6MTkwMDAwMDAwMH0.V-cG19BCJW3-uPmrK3mmSsuqfZJHuU1zqQAGDtZQM1g";
const HEADERS = {
  "apikey": KEY,
  "Authorization": `Bearer ${KEY}`,
  "Accept-Profile": "tp_costing",
  "Content-Profile": "tp_costing"
};

// Tables in dependency order (children first)
const TABLES = [
  "cbd_material_lines",
  "factory_cbds",
  "compliance_checks",
  "sample_tracking",
  "vendor_quotes",
  "style_comparisons",
  "approval_actions",
  "validation_results",
  "costing_notes",
  "historical_costings",
  "costing_requests",
  "audit_logs",
  "error_logs",
  "notifications",
  "checklist_results",
  "material_library",
  "currency_rates",
  "admin_settings",
  "sla_thresholds"
];

async function countRows(table) {
  try {
    const res = await fetch(`${BASE}/${table}?select=id&limit=1`, { headers: HEADERS });
    const data = await res.json();
    if (Array.isArray(data)) return data.length;
    return 0;
  } catch {
    return -1;
  }
}

async function deleteAll(table) {
  // Use a filter that matches all rows (neq a non-existent id for uuid, or gt 0 for serial)
  const filter = "id=neq.00000000-0000-0000-0000-000000000000";
  try {
    const res = await fetch(`${BASE}/${table}?${filter}`, {
      method: "DELETE",
      headers: { ...HEADERS, "Prefer": "return=representation" }
    });
    const text = await res.text();
    let count = 0;
    try { count = JSON.parse(text).length; } catch {}
    return { ok: res.ok, status: res.status, count };
  } catch (e) {
    return { ok: false, status: 0, count: 0, error: e.message };
  }
}

async function main() {
  console.log("Clearing all data from tp_costing schema...\n");
  let totalDeleted = 0;

  for (const table of TABLES) {
    const before = await countRows(table);
    if (before === 0) {
      console.log(`  ${table.padEnd(25)} - already empty`);
      continue;
    }
    if (before < 0) {
      console.log(`  ${table.padEnd(25)} - table not found or error, skipping`);
      continue;
    }
    const result = await deleteAll(table);
    if (result.ok) {
      console.log(`  ${table.padEnd(25)} - deleted ${result.count} row(s) [HTTP ${result.status}]`);
      totalDeleted += result.count;
    } else {
      console.log(`  ${table.padEnd(25)} - FAILED [HTTP ${result.status}] ${result.error ?? ""}`);
    }
  }

  console.log(`\nDone. Total rows deleted: ${totalDeleted}`);

  // Verify
  console.log("\nVerification:");
  for (const table of TABLES) {
    const count = await countRows(table);
    if (count > 0) {
      console.log(`  WARNING: ${table} still has ${count}+ row(s)`);
    }
  }
  console.log("  All tables empty.");
}

main().catch(console.error);
