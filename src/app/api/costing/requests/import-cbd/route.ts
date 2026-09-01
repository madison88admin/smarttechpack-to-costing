import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { canCreateRequest, getCurrentRole } from "@/lib/auth/roles";
import { createCostingRequest } from "@/lib/costing/requests";
import { submitFactoryCbd } from "@/lib/costing/cbd";

const text = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : null; };

export async function POST(request: Request) {
  if (!canCreateRequest(getCurrentRole())) return NextResponse.json({ ok: false, error: "PBD or admin access required" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Excel file is required" }, { status: 400 });
  const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  const values = rows.map((r) => r.map(text));
  const findRight = (label: string) => {
    for (const row of values) { const i = row.findIndex((v) => v.toLowerCase().includes(label.toLowerCase())); if (i >= 0) return row[i + 1] ?? ""; }
    return "";
  };
  const styleNumber = findRight("Style#") || text(file.name).match(/SORELF27-\d+/i)?.[0] || text(file.name).replace(/\.xlsx$/i, "");
  const styleName = findRight("Style Name") || "Imported CBD";
  const customer = findRight("Customer") || "Sorel";
  const season = findRight("Season") || "F27";
  const leadTime = findRight("Leadtime").match(/\d+/)?.[0] ?? "";
  const finishWeight = findRight("Sample Weight");
  const protoVersion = findRight("Proto version");
  const yarnLines: any[] = [], trimLines: any[] = [], knittingLines: any[] = [], operationsLines: any[] = [];
  let standardPackagingCost: number | null = null, specialPackagingCost: number | null = null, overheadCost: number | null = null, profitCost: number | null = null;
  let section = "";
  for (const row of values) {
    const first = row[0] ?? "";
    if (/^YARN$/i.test(first)) { section = "yarn"; continue; }
    if (/^TRIM$/i.test(first)) { section = "trim"; continue; }
    if (/^KNITTING$/i.test(first)) { section = "knitting"; continue; }
    if (/^OPERATIONS$/i.test(first)) { section = "operations"; continue; }
    if (/^SUB TOTAL/i.test(first)) { section = ""; continue; }
    if (/^TOTAL|^FABRIC|^NOTES/i.test(first)) { if (!/^FABRIC/i.test(first)) section = ""; continue; }
    if (/^PACKAGING/i.test(first)) { section = "packaging"; continue; }
    if (/^OVERHEAD\/ PROFIT/i.test(first)) { section = "overhead"; continue; }
    if (!first) continue;
    if (section === "yarn" && num(row[1]) !== null && num(row[2]) !== null) yarnLines.push({ name: first, consumption: num(row[1]), materialPrice: num(row[2]), materialCost: num(row[3]) ?? 0 });
    if (section === "trim" && num(row[1]) !== null && num(row[2]) !== null) trimLines.push({ name: first, consumption: num(row[1]), materialPrice: num(row[2]), materialCost: num(row[3]) ?? 0 });
    if (section === "knitting" && num(row[1]) !== null) knittingLines.push({ machineType: first, knittingTime: num(row[1]), sah: num(row[2]) ?? 0, knittingCost: num(row[3]) ?? 0 });
    if (section === "operations" && num(row[3]) !== null) operationsLines.push({ operation: first, operationCost: num(row[3]) ?? 0 });
    if (section === "packaging" && /^Standard Packaging$/i.test(first)) standardPackagingCost = num(row[2]);
    if (section === "packaging" && /^Special Packaging$/i.test(first)) specialPackagingCost = num(row[2]);
    if (section === "overhead" && /^OVERHEAD$/i.test(first)) overheadCost = num(row[2]);
    if (section === "overhead" && /^PROFIT$/i.test(first)) profitCost = num(row[2]);
  }
  try {
    const created = await createCostingRequest({ styleNumber, productName: styleName, factoryName: text(form.get("factoryName")) || undefined, season, customer, brand: customer, notes: `Imported from ${file.name}`, forceCreate: true, bomLines: [] });
    await submitFactoryCbd({ costingRequestId: created.id, status: "draft", currency: "USD", customer, season, styleNumber, styleName, leadTimeDays: leadTime, finishWeight, protoVersion, yarnLines, trimLines, knittingLines, operationsLines, standardPackagingCost, specialPackagingCost, overheadCost, profitCost, lines: [], notes: `Imported from ${file.name}` });
    return NextResponse.json({ ok: true, data: { id: created.id, requestNumber: created.request_number, styleNumber, styleName, importedLines: yarnLines.length + trimLines.length + knittingLines.length + operationsLines.length } }, { status: 201 });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to import CBD" }, { status: 500 }); }
}
