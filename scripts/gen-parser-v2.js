const fs = require('fs');

const content = `import * as XLSX from "xlsx";

export type ParsedCbdData = {
  customer: string | null;
  season: string | null;
  styleNumber: string | null;
  styleName: string | null;
  costedQty: string | null;
  leadTimeDays: number | null;
  finishWeight: string | null;
  moq: number | null;
  yarnLines: Array<{ name: string; consumption: string; materialPrice: string; materialCost: string }>;
  fabricLines: Array<{ name: string; consumption: string; materialPrice: string; materialCost: string }>;
  trimLines: Array<{ name: string; consumption: string; materialPrice: string; materialCost: string }>;
  knittingLines: Array<{ machineType: string; knittingTime: string; sah: string; knittingCost: string }>;
  operationsLines: Array<{ operation: string; operationCost: string }>;
  standardPackagingCost: number | null;
  specialPackagingCost: number | null;
  overheadCost: number | null;
  profitCost: number | null;
  totalFactoryCost: number | null;
  warnings: string[];
  errors: string[];
};

export function parseCbdExcel(buffer: Buffer | ArrayBuffer): ParsedCbdData {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("No sheets found");

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: null });

  const warnings: string[] = [];
  const errors: string[] = [];

  const result: ParsedCbdData = {
    customer: null, season: null, styleNumber: null, styleName: null,
    costedQty: null, leadTimeDays: null, finishWeight: null, moq: null,
    yarnLines: [], fabricLines: [], trimLines: [],
    knittingLines: [], operationsLines: [],
    standardPackagingCost: null, specialPackagingCost: null,
    overheadCost: null, profitCost: null, totalFactoryCost: null,
    warnings, errors
  };

  const getStr = (r: number, c: number): string => {
    const v = rows[r]?.[c];
    return v == null ? "" : String(v).trim();
  };

  const getNum = (r: number, c: number): number | null => {
    const v = rows[r]?.[c];
    if (v == null) return null;
    const n = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  const findSection = (keywords: string[]): number => {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]?.some(c => keywords.some(kw => String(c ?? "").toLowerCase().includes(kw.toLowerCase())))) return i;
    }
    return -1;
  };

  // 1. PARSE HEADERS (first 10 rows)
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] ?? "").trim();
      if (cell.includes("Customer") && (cell.includes("：") || cell.includes(":"))) {
        const val = getStr(i, j + 1);
        if (val && !val.toLowerCase().includes("customer")) result.customer = val;
      }
      if (cell.includes("Season") && (cell.includes("：") || cell.includes(":"))) {
        const val = getStr(i, j + 1);
        if (val && !val.toLowerCase().includes("season")) result.season = val;
      }
      if (cell.includes("Style") && cell.includes("#")) {
        const val = getStr(i, j + 1);
        if (val && !val.toLowerCase().includes("style")) result.styleNumber = val;
      }
      if (cell.includes("Style Name") && cell.includes(":")) {
        const val = getStr(i, j + 1);
        if (val) result.styleName = val.replace(/\r?\n/g, " ").trim();
      }
      if (cell.includes("MOQ") && cell.includes(":")) {
        const val = getStr(i, j + 1);
        const m = val.match(/(\d+)/);
        if (m) result.moq = parseInt(m[1]);
      }
      if (cell.toLowerCase().includes("leadtime")) {
        const val = getStr(i, j + 1);
        const m = val.match(/(\d+)/);
        if (m) result.leadTimeDays = parseInt(m[1]);
      }
      if (cell.toLowerCase().includes("sample weight")) {
        const val = getStr(i, j + 1);
        if (val) result.finishWeight = val;
      }
    }
  }

  // 2. PARSE SECTIONS
  const yarnH = findSection(["YARN"]);
  const fabricH = findSection(["FABRIC"]);
  const trimH = findSection(["TRIM"]);
  const knitH = findSection(["KNITTING"]);
  const opsH = findSection(["OPERATIONS"]);
  const pkgH = findSection(["PACKAGING"]);
  const ohH = findSection(["OVERHEAD"]);
  const totalH = findSection(["TOTAL FACTORY COST"]);

  // Material sections: name[0], consumption[1], price[2], cost[3]
  const parseMaterial = (start: number, end: number) => {
    const lines: Array<{ name: string; consumption: string; materialPrice: string; materialCost: string }> = [];
    if (start < 0) return lines;
    for (let i = start + 1; i < Math.min(end >= 0 ? end : start + 15, rows.length); i++) {
      const fc = getStr(i, 0).toLowerCase();
      if (fc.includes("total") || fc.includes("sub total")) break;
      const name = getStr(i, 0);
      if (!name || name === "0") continue;
      const consumption = getNum(i, 1);
      const price = getNum(i, 2);
      const cost = getNum(i, 3);
      if (consumption || price || cost) {
        lines.push({ name, consumption: consumption?.toString() ?? "", materialPrice: price?.toString() ?? "", materialCost: cost?.toString() ?? "" });
      }
    }
    return lines;
  };

  if (yarnH >= 0) {
    const next = fabricH >= 0 ? fabricH : (trimH >= 0 ? trimH : (knitH >= 0 ? knitH : yarnH + 15));
    result.yarnLines = parseMaterial(yarnH, next);
  }
  if (fabricH >= 0) {
    const next = trimH >= 0 ? trimH : (knitH >= 0 ? knitH : fabricH + 15);
    result.fabricLines = parseMaterial(fabricH, next);
  }
  if (trimH >= 0) {
    const next = knitH >= 0 ? knitH : trimH + 15;
    result.trimLines = parseMaterial(trimH, next);
  }

  // Knitting: name[0], time[1], sah[2], cost[3]
  if (knitH >= 0) {
    const next = opsH >= 0 ? opsH : knitH + 15;
    for (let i = knitH + 1; i < Math.min(next, rows.length); i++) {
      const name = getStr(i, 0);
      if (!name || name === "0") continue;
      const time = getNum(i, 1);
      const sah = getNum(i, 2);
      const cost = getNum(i, 3);
      if (time || sah || cost) {
        result.knittingLines.push({
          machineType: name, knittingTime: time?.toString() ?? "",
          sah: sah?.toString() ?? "", knittingCost: cost?.toString() ?? (time && sah ? (time * sah).toFixed(2) : "")
        });
      }
    }
  }

  // Operations: name[0], cost[3] (NOT column 2!)
  if (opsH >= 0) {
    const next = pkgH >= 0 ? pkgH : opsH + 20;
    for (let i = opsH + 1; i < Math.min(next, rows.length); i++) {
      const name = getStr(i, 0);
      if (!name || name === "0") continue;
      if (name.toLowerCase().includes("sub total")) break;
      const cost = getNum(i, 3); // Column 3, not 2!
      if (name && cost) {
        result.operationsLines.push({ operation: name, operationCost: cost.toString() });
      }
    }
  }

  // Packaging: name[0], cost[3] (NOT column 2!)
  if (pkgH >= 0) {
    const next = ohH >= 0 ? ohH : pkgH + 10;
    for (let i = pkgH + 1; i < Math.min(next, rows.length); i++) {
      const name = getStr(i, 0).toLowerCase();
      const cost = getNum(i, 3); // Column 3!
      if (name.includes("standard") && cost != null) result.standardPackagingCost = cost;
      else if (name.includes("special") && cost != null) result.specialPackagingCost = cost;
    }
  }

  // Overhead/Profit: name[0], cost[3] (NOT column 2!)
  if (ohH >= 0) {
    const next = totalH >= 0 ? totalH : ohH + 10;
    for (let i = ohH + 1; i < Math.min(next, rows.length); i++) {
      const name = getStr(i, 0).toLowerCase();
      const cost = getNum(i, 3); // Column 3!
      if (name.includes("overhead") && cost != null) result.overheadCost = cost;
      else if (name.includes("profit") && cost != null) result.profitCost = cost;
    }
  }

  // Total Factory Cost: name[0], cost[3]
  if (totalH >= 0) {
    result.totalFactoryCost = getNum(totalH, 3); // Column 3!
  }

  if (!result.customer) warnings.push("Customer not found in Excel");
  if (!result.styleNumber) warnings.push("Style number not found in Excel");
  if (res
