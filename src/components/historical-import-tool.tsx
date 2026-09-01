"use client";

import { useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";

type ImportRecord = {
  style_number: string;
  factory_name?: string;
  yarn_type?: string;
  knit_type?: string;
  machine_type?: string;
  construction?: string;
  product_category?: string;
  currency?: string;
  average_consumption?: number;
  knitting_time?: number;
  labor_cost?: number;
  overhead_cost?: number;
  total_cost?: number;
  approved_at?: string;
  // Extended Data Bank fields – stored via raw_payload on the server
  brand?: string;
  customer?: string;
  season?: string;
  style_name?: string;
  material_price?: number;
  knitting_cpm?: number;
  knitting_cost?: number;
  ops_cost?: number;
  packaging_cost?: number;
  profit?: number;
  raw_payload?: Record<string, unknown>;
};

export function HistoricalImportTool() {
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [dragOver, setDragOver] = useState(false);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    readFile(file);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) readFile(file);
  }

  function readFile(file: File) {
    setError("");
    setResult("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
          const workbook = XLSX.read(e.target?.result, { type: "array", cellDates: true });
          // Data Bank 7.25.25.xlsx has 3 sheets: Sheet1 (main), Mat Analysis (benchmarks), Sheet2 (empty)
          // Prefer Sheet1, fallback to first non-empty sheet
          let sheetName = workbook.SheetNames.includes("Sheet1") ? "Sheet1" : workbook.SheetNames[0];
          let sheet = workbook.Sheets[sheetName];
          let rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
          // If preferred sheet is empty, try other sheets
          if (rows.length === 0) {
            for (const name of workbook.SheetNames) {
              const candidate = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], { defval: null });
              if (candidate.length > 0) {
                sheetName = name;
                rows = candidate;
                break;
              }
            }
          }
          const mapped = rows.map(mapDataBankRow).filter((record) => record.style_number);
          if (mapped.length === 0) {
            setError(`No valid records found in sheet "${sheetName}". Check that headers include Style Number / Style Name. Sheets found: ${workbook.SheetNames.join(", ")}`);
          }
          setRecords(mapped);
        } else {
          const text = String(e.target?.result ?? "");
          if (file.name.endsWith(".json")) {
            const parsed = JSON.parse(text);
            const recs = Array.isArray(parsed) ? parsed : parsed.records ?? [];
            setRecords(recs);
          } else if (file.name.endsWith(".csv")) {
            const recs = parseCsv(text);
            setRecords(recs);
          } else {
            setError("Please upload a .xlsx, .xls, .json, or .csv file");
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse file. Ensure it is valid.");
      }
    };
    if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }

  async function importRecords() {
    if (records.length === 0) return;
    setBusy(true);
    setResult("");
    try {
      const response = await fetch("/api/admin/import-historical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records })
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        const parts = [`Imported ${data.imported} record(s)`];
        if (data.skippedDuplicates > 0) {
          parts.push(`${data.skippedDuplicates} duplicate(s) skipped`);
        }
        if (data.failed > 0) {
          parts.push(`${data.failed} failed`);
        }
        setResult(parts.join(", ") + ".");
        setRecords([]);
      } else {
        setResult(data.error ?? "Import failed");
      }
    } catch {
      setResult("Import request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        className={`import-zone ${dragOver ? "dragover" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <p>
          <strong>Upload Historical Costing Data</strong>
        </p>
        <p className="eyebrow">Drag & drop a Data Bank .xlsx/.xls, .json, or .csv file, or click to browse</p>
        <input
          type="file"
          accept=".xlsx,.xls,.json,.csv"
          onChange={handleFile}
          style={{ marginTop: 8 }}
        />
      </div>

      {error ? <p className="form-message error">{error}</p> : null}

      {records.length > 0 ? (
        <div className="import-preview">
          <p className="eyebrow">
            Preview: <strong>{records.length} record(s) ready to import</strong> — Data Bank columns mapped: Season/Customer/Style/Material/Machine/Time/Cost
          </p>
          <table className="table compact">
            <thead>
              <tr>
                <th>Style</th>
                <th>Customer</th>
                <th>Season</th>
                <th>Material</th>
                <th>Machine</th>
                <th>Knitting Time</th>
                <th>Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 20).map((rec, i) => (
                <tr key={i}>
                  <td>{rec.style_number}</td>
                  <td>{rec.customer ?? "—"}</td>
                  <td>{rec.season ?? "—"}</td>
                  <td>{rec.yarn_type ?? "—"}</td>
                  <td>{rec.machine_type ?? "—"}</td>
                  <td>{rec.knitting_time ?? "—"}</td>
                  <td>{rec.total_cost != null ? `$${rec.total_cost}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {records.length > 20 ? <p className="eyebrow">...and {records.length - 20} more</p> : null}
          <div className="form-actions" style={{ marginTop: 12 }}>
            <button className="button" onClick={importRecords} disabled={busy}>
              {busy ? "Importing..." : `Import ${records.length} Records`}
            </button>
            <button className="button secondary" onClick={() => setRecords([])} disabled={busy}>
              Clear
            </button>
          </div>
          <p className="eyebrow" style={{ marginTop: 8 }}>Extra costs (packaging/OH/profit/material price) are preserved in raw_payload for benchmarking.</p>
        </div>
      ) : null}

      {result ? <p className="form-message saved">{result}</p> : null}

      <details style={{ marginTop: 16 }}>
        <summary className="eyebrow" style={{ cursor: "pointer" }}>Expected CSV format</summary>
        <pre style={{ fontSize: "0.75rem", marginTop: 8, overflow: "auto" }}>
{`style_number,factory_name,yarn_type,knit_type,machine_type,construction,product_category,currency,average_consumption,knitting_time,labor_cost,overhead_cost,total_cost,approved_at
M88118568,Cebu Factory,Wool,Flat,Manual,Knitted,Hat,USD,0.15,12.5,2.00,0.80,5.50,2025-01-15
M8836232,Manila Factory,Cotton,Jersey,Auto,Knitted,Tee,USD,0.20,8.0,1.50,0.60,4.20,2025-02-01`}
        </pre>
      </details>
    </div>
  );
}

function parseCsv(text: string): ImportRecord[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const records: ImportRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && !values[0].trim())) continue;

    const record: Record<string, unknown> = {};
    for (let j = 0; j < headers.length && j < values.length; j++) {
      const val = values[j].trim();
      if (val) record[headers[j]] = val;
    }

    records.push({
      style_number: String(record.style_number ?? ""),
      factory_name: record.factory_name ? String(record.factory_name) : undefined,
      yarn_type: record.yarn_type ? String(record.yarn_type) : undefined,
      knit_type: record.knit_type ? String(record.knit_type) : undefined,
      machine_type: record.machine_type ? String(record.machine_type) : undefined,
      construction: record.construction ? String(record.construction) : undefined,
      product_category: record.product_category ? String(record.product_category) : undefined,
      currency: record.currency ? String(record.currency) : undefined,
      average_consumption: toNumVal(record.average_consumption),
      knitting_time: toNumVal(record.knitting_time),
      labor_cost: toNumVal(record.labor_cost),
      overhead_cost: toNumVal(record.overhead_cost),
      total_cost: toNumVal(record.total_cost),
      approved_at: record.approved_at ? String(record.approved_at) : undefined
    });
  }

  return records;
}

/** Normalize header for fuzzy matching: lowercase, trim, collapse spaces/underscores */
function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, " ").replace(/\./g, "");
}

function mapDataBankRow(row: Record<string, unknown>): ImportRecord {
  // Build normalized lookup once per row for O(1) fuzzy matching
  const normalizedMap = new Map<string, string>();
  for (const key of Object.keys(row)) normalizedMap.set(normalizeHeader(key), key);

  const get = (...names: string[]) => {
    for (const name of names) {
      const norm = normalizeHeader(name);
      // Exact normalized match
      if (normalizedMap.has(norm)) return row[normalizedMap.get(norm)!];
      // Fuzzy: check if any header contains the name or vice-versa (handles "TTL FTY COST" vs "TTLFTY COST")
      for (const [headerNorm, originalKey] of normalizedMap) {
        if (headerNorm.includes(norm) || norm.includes(headerNorm)) {
          // Only fuzzy for multi-word headers to avoid false positives
          if (norm.length >= 3 && headerNorm.length >= 3) return row[originalKey];
        }
      }
    }
    return null;
  };
  const text = (value: unknown) => value == null || value === "" ? undefined : String(value).trim();
  const number = (value: unknown) => typeof value === "number" ? value : toNumVal(value);
  // Style: prefer Style Number, fallback to Style Name / Style No / Style
  const style = text(get("Style Number", "Style No", "Style #", "Style")) ?? text(get("Style Name")) ?? "";
  const customer = text(get("Customer"));
  const season = text(get("Season"));
  const brand = text(get("Brand"));
  const styleName = text(get("Style Name"));
  const productCategory = text(get("Product Category", "Category", "Commodity")) ?? styleName;
  // Material
  const yarnType = text(get("Main Material", "Material", "Yarn Type", "Yarn", "Composition"));
  const materialPrice = number(get("Material Price", "Unit Price", "Price"));
  const consumption = number(get("Material Consumption", "Average Consumption", "Consumption", "Avg Consumption"));
  // Knitting
  const machineType = text(get("Knitting Machine", "Machine Type", "Machine", "Knitting M/C"));
  const knittingTime = number(get("Knitting Time", "KnittingTime", "Knit Time", "SMV", "GSD SMV"));
  const knittingCpm = number(get("Knitting CPM", "CPM", "Cost Per Minute"));
  const knittingCost = number(get("Knitting Cost", "Knit Cost"));
  const opsCost = number(get("Ops Cost", "Operations Cost", "Operation Cost", "OP Cost"));
  const knittingOpsCombined = number(get("Knitting + Ops Cost", "Knitting+Ops Cost"));
  // Packaging / OH / Profit / Total
  const packagingCost = number(get("Packaging", "Pack Cost", "Packaging Cost"));
  const overheadCost = number(get("OH", "Overhead", "Overhead Cost"));
  const profitVal = number(get("PROFIT", "Profit", "Profit Cost", "Profit Amount"));
  const totalCost = number(get("TTL FTY COST", "TTL FTY Cost", "TTL Factory Cost", "Total Cost", "Total Factory Cost", "TTL Cost", "Grand Total", "Factory Cost"));
  // Labor: prefer combined, else sum of knitting+ops
  const laborCost = knittingOpsCombined ?? (knittingCost != null || opsCost != null ? (knittingCost ?? 0) + (opsCost ?? 0) : undefined);

  // Preserve all raw fields for benchmarks / like-styles (material price, cpm, etc.)
  const rawPayload: Record<string, unknown> = { ...row };
  // Also stash the parsed normalized fields explicitly
  rawPayload["_parsed_material_price"] = materialPrice;
  rawPayload["_parsed_knitting_cpm"] = knittingCpm;
  rawPayload["_parsed_knitting_cost"] = knittingCost;
  rawPayload["_parsed_ops_cost"] = opsCost;
  rawPayload["_parsed_packaging"] = packagingCost;
  rawPayload["_parsed_profit"] = profitVal;

  return {
    style_number: style,
    factory_name: text(get("Factory", "Factory Name", "Supplier Name", "Supplier")),
    yarn_type: yarnType,
    knit_type: text(get("Knit Type", "KnitType")) ?? text(get("Construction")),
    machine_type: machineType,
    construction: text(get("Construction")),
    product_category: productCategory,
    currency: text(get("Currency")) ?? "USD",
    average_consumption: consumption,
    knitting_time: knittingTime,
    labor_cost: laborCost,
    overhead_cost: overheadCost,
    total_cost: totalCost,
    approved_at: text(get("Approved At", "Approved Date", "Date")) ?? season,
    brand,
    customer,
    season,
    style_name: styleName,
    material_price: materialPrice,
    knitting_cpm: knittingCpm,
    knitting_cost: knittingCost,
    ops_cost: opsCost,
    packaging_cost: packagingCost,
    profit: profitVal,
    raw_payload: rawPayload
  };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function toNumVal(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
