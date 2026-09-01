import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const envPath = path.join(root, ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Supabase service environment variables are not configured");
const supabase = createClient(url, key, { auth: { persistSession: false } }).schema("tp_costing");

const files = [
  { type: "mml", file: path.join(process.env.USERPROFILE, "Downloads", "F27 M88 MML SMS-20260612.xlsx") },
  { type: "costing_metric", file: path.join(process.env.USERPROFILE, "Downloads", "Costing Metric.xlsx") }
];
const clean = (v) => v == null ? null : String(v).trim() || null;
const rows = [];
for (const { type, file } of files) {
  if (!fs.existsSync(file)) throw new Error(`Missing workbook: ${file}`);
  const wb = XLSX.readFile(file, { cellDates: true });
  for (const sheet of wb.SheetNames) {
    const values = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: null });
    const header = (values[1] || values[0] || []).map(clean);
    for (let i = 2; i < values.length; i++) {
      const cells = values[i] || [];
      if (!cells.some((v) => clean(v))) continue;
      const raw = Object.fromEntries(header.map((h, j) => h ? [h, cells[j] ?? null] : []).filter(Boolean));
      const text = cells.map(clean).filter(Boolean).join(" | ");
      rows.push({
        reference_type: type,
        source_workbook: path.basename(file),
        source_sheet: sheet,
        row_number: i + 1,
        category: clean(cells[0]),
        material_type: clean(cells[2]),
        material_name: clean(cells[3] ?? cells[1]),
        brand: /brand|account/i.test(text) ? clean(cells[0]) : null,
        factory: null,
        season: text.match(/(?:F|S|FW|SS)\d{2,4}/i)?.[0] ?? null,
        unit: clean(cells[13] ?? cells[5]),
        supplier: clean(cells[5]),
        effective_date: null,
        numeric_value: null,
        raw_data: raw
      });
    }
  }
}
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await supabase.from("template_reference_data").upsert(rows.slice(i, i + 500), { onConflict: "reference_type,source_workbook,source_sheet,row_number" });
  if (error) throw error;
}
const counts = rows.reduce((a, r) => ((a[r.reference_type] = (a[r.reference_type] || 0) + 1), a), {});
console.log(JSON.stringify({ ok: true, imported: rows.length, counts }));
