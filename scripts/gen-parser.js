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

  const rowHas = (r: number, keyword: string): boolean => {
    const row = rows[r];
    if (!row) return false;
    return row.some(c => String(c ?? "").toLowerCase().includes(keyword.toLowerCase()));
  };

  const findSection = (keywords: string[]): number => {
    for (let i = 0; i < rows.length; i++) {
      if (keywords.some(kw => rowHas(i, kw))) return i;
    }
    return -1;
  };

  // 1. PARSE HEADERS
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] ?? "").trim();
      if (cell.toLowerCase().includes("customer") && (cell.includes("：") || cell.includes(":"))) {
        const val = getStr(i, j + 1);
        if (val && !val.toLowerCase().includes("customer")) result.customer = val;
      }
      if (cell.toLowerCase().includes("season") && (cell.includes("：") || cell.includes(":"))) {
        const val = getStr(i, j + 1);
        if (val && !val.toLowerCase().includes("season")) result.season = val;
      }
      if (cell.toLowerCase().includes("style") && cell.includes("#")) {
        const val = getStr(i, j + 1);
        if (val && !val.toLowerCase().includes("style")) result.styleNumber = val;
      }
      if (cell.toLowerCase().includes("style name") && cell.includes(":")) {
        const val = getStr(i, j + 1);
        if (val) result.styleName = val.replace(/\r?\n/g, " ").trim();
      }
      if (cell.toLowerCase().includes("moq") && cell.includes(":")) {
        const val = getStr(i, j + 1);
        const m = val.match(/(\d+)/);
        if (m) result.moq = parseInt(m[1]);
      }
      if (cell.toLowerCase().includes("leadtime") || cell.toLowerCase().includes("lead time")) {
        const val = getStr(i, j + 1);
        const m = val.match(/(\d+)/);
        if (m) result.leadTimeDays = parseInt(m[1]);
      }
      if (cell.toLowerCase().includes("sample weight") || cell.toLowerCase().includes("finish weight")) {
        const val = getStr(i, j + 1);
        if (val) result.finishWeight = val;
      }
    }
  }

  // 2. PARSE SECTIONS
  const yarnHeader = findSection(["YARN"]);
  const fabricHeader = findSection(["FABRIC"]);
  const trimHeader = findSection(["TRIM"]);
  const knittingHeader = findSection(["KNITTING"]);
  const operationsHeader = findSection(["OPERATIONS"]);
  const packagingHeader = findSection(["PACKAGING"]);
  const overheadHeader = findSection(["OVERHEAD"]);
  const totalRow = findSection(["TOTAL FACTORY COST"]);

  const parseMaterialSection = (start: number, end: number) => {
    const lines: Array<{ name: string; consumption: string; materialPrice: string; materialCost: string }> = [];
    if (start < 0) return lines;
    for (let i = start + 1; i < Math.min(end >= 0 ? end : start + 15, rows.length); i++) {
      const firstCell = getStr(i, 0).toLowerCase();
      if (firstCell.includes("total") || firstCell.includes("sub total")) break;
      const name = getStr(i, 0);
      if (!name || name === "0") continue;
      const consumption = getNum(i, 1);
      const price = getNum(i, 2);
      const cost = getNum(i, 3);
      if (name || consumption || price || cost) {
        lines.push({
          name,
          consumption: consumption?.toString() ?? "",
          materialPrice: price?.toString() ?? "",
          materialCost: cost?.toString() ?? ""
        });
      }
    }
    return lines;
  };

  if (yarnHeader >= 0) {
    const next = fabricHeader >= 0 ? fabricHeader : (trimHeader >= 0 ? trimHeader : (knittingHeader >= 0 ? knittingHeader : yarnHeader + 15));
    result.yarnLines = parseMaterialSection(yarnHeader, next);
  }
  if (fabricHeader >= 0) {
    const next = trimHeader >= 0 ? trimHeader : (knittingHeader >= 0 ? knittingHeader : fabricHeader + 15);
    result.fabricLines = parseMaterialSection(fabricHeader, next);
  }
  if (trimHeader >= 0) {
    const next = knittingHeader >= 0 ? knittingHeader : trimHeader + 15;
    result.trimLines = parseMaterialSection(trimHeader, next);
  }

  if (knittingHeader >= 0) {
    const next = operationsHeader >= 0 ? operationsHeader : knittingHeader + 15;
    for (let i = knittingHeader + 1; i < Math.min(next, rows.length); i++) {
      const name = getStr(i, 0);
      if (!name || name === "0") continue;
      const time = getNum(i, 1);
      const sah = getNum(i, 2);
      const cost = getNum(i, 3);
      if (name || time || sah) {
        result.knittingLines.push({
          machineType: name,
          knittingTime: time?.toString() ?? "",
          sah: sah?.toString() ?? "",
          knittingCost: cost?.toString() ?? (time && sah ? (time * sah).toFixed(2) : "")
        });
      }
    }
  }

  if (operationsHeader >= 0) {
    const next = packagingHeader >= 0 ? packagingHeader : operationsHeader + 20;
    for (let i = operationsHeader + 1; i < Math.min(next, rows.length); i++) {
      const name = getStr(i, 0);
      if (!name || name === "0") continue;
      if (name.toLowerCase().includes("sub total")) break;
      const cost = getNum(i, 2);
      if (name && cost) {
        result.operationsLines.push({ operation: name, operationCost: cost.toString() });
      }
    }
  }

  if (packagingHeader >= 0) {
    const next = overheadHeader >= 0 ? overheadHeader : packagingHeader + 10;
    for (let i = packagingHeader + 1; i < Math.min(next, rows.length); i++) {
      const name = getStr(i, 0).toLowerCase();
      const cost = getNum(i, 2);
      if (name.includes("standard") && cost != null) result.standardPackagingCost = cost;
      else if (name.includes("special") && cost != null) result.specialPackagingCost = cost;
    }
  }

  if (overheadHeader >= 0) {
    const next = totalRow >= 0 ? totalRow : overheadHeader + 10;
    for (let i = overheadHeader + 1; i < Math.min(next, rows.length); i++) {
      const name = getStr(i, 0).toLowerCase();
      con
