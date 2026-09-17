// Read-only hunt for surviving references to a deleted request number.
//
// Deleting a request cascades to most child tables, but a few (system error
// logs, read receipts, comparison sets) may keep a copy of the number in free
// text. This lists anything still mentioning it, so we know whether the
// deleted request can be reconstructed from the database alone.
//
// Usage: node --env-file=.env.local scripts/find-request-references.mjs CR-621716
import { createClient } from "@supabase/supabase-js";

const needle = (process.argv[2] ?? "").replace(/[^0-9A-Za-z-]/g, "");
if (!needle) {
  console.error("usage: node scripts/find-request-references.mjs <request-number>");
  process.exit(1);
}

const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false }, db: { schema: "tp_costing" } }
);

const TABLES = [
  "costing_requests", "historical_costings", "factory_cbds", "cbd_material_lines",
  "cbd_change_requests", "cbd_photos", "validation_results", "compliance_checks",
  "request_checklist_results", "in_app_alerts", "notification_queue", "notification_reads",
  "notification_recipients", "notification_templates", "approval_actions", "workflow_events",
  "costing_notes", "saved_comparison_sets", "style_comparisons", "sample_tracking",
  "customer_revision_history", "customer_approval_attachments", "vendor_quotes",
  "master_benchmark_history", "master_material_benchmarks", "material_library",
  "nextgen_bom_lines", "nextgen_products", "system_error_logs", "user_profiles",
  "currency_rates", "currency_rate_history", "template_reference_data", "workflow_settings",
  "validation_checklist_items", "schema_migrations"
];

const hits = [];
for (const table of TABLES) {
  const { data: sample, error: sampleError } = await client.from(table).select("*").limit(1);
  if (sampleError) {
    // Table may genuinely not exist in this deployment; report and move on.
    if (!/does not exist|schema cache/.test(sampleError.message)) {
      hits.push({ table, error: sampleError.message });
    }
    continue;
  }
  const columns = Object.keys(sample?.[0] ?? {});
  if (!columns.length) continue;

  // Try each plausible text column on its own: PostgREST rejects ilike on
  // uuid/timestamp/numeric columns with "operator does not exist", which is the
  // signal to skip that column rather than the table.
  const candidates = columns.filter(
    (c) => !/(^id$|_id$|_at$|^is_|^has_|count$|^version$|^moq$|amount$|price$|cost$|^percent)/.test(c)
  );
  const tableHits = [];
  for (const column of candidates) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .ilike(column, `%${needle}%`)
      .limit(3);
    if (error) {
      if (/operator does not exist|invalid input syntax/.test(error.message)) continue;
      hits.push({ table, error: error.message });
      break;
    }
    if (data?.length) tableHits.push({ column, rows: data });
  }
  if (tableHits.length) hits.push({ table, rows: tableHits.flatMap((h) => h.rows) });
}

if (!hits.length) {
  console.log(`No surviving row in any tp_costing table mentions ${needle}.`);
} else {
  for (const hit of hits) {
    if (hit.error) {
      console.log(`${hit.table}: could not scan (${hit.error})`);
      continue;
    }
    console.log(`${hit.table}: ${hit.rows.length} matching row(s)`);
    for (const row of hit.rows) console.log("   ", JSON.stringify(row).slice(0, 600));
  }
}
