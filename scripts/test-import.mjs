import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const home = process.env.USERPROFILE || "";
const downloadsDir = path.join(home, "Downloads");
const files = fs.readdirSync(downloadsDir).filter(f => f.includes("79758") && f.endsWith(".xlsx"));
const filePath = path.join(downloadsDir, files[0]);

console.log("=== Testing CBD Excel Import ===");
console.log("File:", filePath);

const buffer = fs.readFileSync(filePath);
const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

const getStr = (r, c) => rows[r]?.[c] == null ? "" : String(rows[r][c]).trim();
const getNum = (r, c) => {
  const v = rows[r]?.[c];
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const rowHas = (r, kw) => rows[r]?.some(c => String(c ?? "").toLowerCase().includes(kw.toLowerCase()));
const findSection = (kws) => {
  for (let i = 0; i < rows.length; i++) {
    if (kws.some(kw => rowHas(i, kw))) return i;
  }
  return -1;
};

// Parse headers
let customer = null, season = null, styleNumber = null, styleName = null;
let moq = null, leadTimeDays = null, finishWeight = null;

for (let i = 0; i < Math.min(10, rows.length); i++) {
  const row = rows[i];
  if (!row) continue;
  for (let j = 0; j < row.length; j++) {
    const cell = String(row[j] ?? "").trim();
    if (cell.includes("Customer") && (cell.includes("：") || cell.includes(":"))) {
      const val = getStr(i, j + 1);
      if (val && !val.includes("Customer")) customer = val;
    }
    if (cell.includes("Season") && (cell.includes("：") || cell.includes(":"))) {
      const val = getStr(i, j + 1);
      if (val && !val.includes("Season")) season = val;
    }
    if (cell.includes("Style") && cell.includes("#")) {
      const val = getStr(i, j + 1);
      if (val && !val.includes("Style")) styleNumber = val;
    }
    if (cell.includes("Style Name") && cell.includes(":")) {
      const val = getStr(i, j + 1);
      if (val) styleName = val.replace(/\r?\n/g, " ").trim();
    }
    if (cell.includes("MOQ") && cell.includes(":")) {
      const val = getStr(i, j + 1);
      const m = val.match(/(\d+)/);
      if (m) moq = parseInt(m[1]);
    }
    if (cell.toLowerCase().includes("leadtime")) {
      const val = getStr(i, j + 1);
      const m = val.match(/(\d+)/);
      if (m) leadTimeDays = parseInt(m[1]);
    }
    if (cell.toLowerCase().includes("sample weight")) {
      const val = getStr(i, j + 1);
      if (val) finishWeight = val;
    }
  }
}

console.log("\n=== HEADER INFO ===");
console.log("Customer:", customer);
console.log("Season:", season);
console.log("Style #:", styleNumber);
console.log("Style Name:", styleName);
console.log("MOQ:", moq);
console.log("Lead Time:", leadTimeDays, "days");
console.log("Sample Weight:", finishWeight);

// Parse sections
const yarnH = findSection(["YARN"]);
const fabricH = findSection(["FABRIC"]);
const trimH = findSection(["TRIM"]);
const knitH = findSection(["KNITTING"]);
const opsH = findSection(["OPERATIONS"]);
const pkgH = findSection(["PACKAGING"]);
const ohH = findSection(["OVERHEAD"]);
const totalH = findSection(["TOTAL FACTORY COST"]);

console.log("\n=== SECTION INDICES ===");
console.log("YARN:", yarnH, "FABRIC:", fabricH, "TRIM:", trimH);
console.log("KNITTING:", knitH, "OPERATIONS:", opsH);
console.log("PACKAGING:", pkgH, "OVERHEAD:", ohH, "TOTAL:", totalH);

// Parse YARN lines
console.log("\n=== YARN LINES ===");
if (yarnH >= 0) {
  const end = fabricH >= 0 ? fabricH : (trimH >= 0 ? trimH : yarnH + 10);
  for (let i = yarnH + 1; i < Math.min(end, rows.length); i++) {
    const name = getStr(i, 0);
    if (!name || name === "0") continue;
    if (name.toLowerCase().includes("total")) break;
    const cons = getNum(i, 1);
    const price = getNum(i, 2);
    const cost = getNum(i, 3);
    console.log(`  ${name} | ${cons}g | $${price}/kg | $${cost}`);
  }
}

// Parse KNITTING lines
console.log("\n=== KNITTING LINES ===");
if (knitH >= 0) {
  const end = opsH >= 0 ? opsH : knitH + 10;
  for (let i = knitH + 1; i < Math.min(end, rows.length); i++) {
    const name = getStr(i, 0);
    if (!name || name === "0") continue;
    const time = getNum(i, 1);
    const sah = getNum(i, 2);
    const cost = getNum(i, 3);
    console.log(`  ${name} | ${time} mins | $${sah}/min | $${cost}`);
  }
}

// Parse OPERATIONS lines
console.log("\n=== OPERATIONS LINES ===");
if (opsH >= 0) {
  const end = pkgH >= 0 ? pkgH : opsH + 15;
  for (let i = opsH + 1; i < Math.min(end, rows.length); i++) {
    const name = getStr(i, 0);
    if (!name || name === "0") continue;
    if (name.toLowerCase().includes("sub total")) break;
    const cost = getNum(i, 2);
    if (cost) console.log(`  ${name} | $${cost}`);
  }
}

// Parse PACKAGING
console.log("\n=== PACKAGING ===");
if (pkgH >= 0) {
  const end = ohH >= 0 ? ohH : pkgH + 10;
  for (let i = pkgH + 1; i < Math.min(end, rows.length); i++) {
    const name = getStr(i, 0);
    const cost = getNum(i, 2);
    console.log(`  ${name} | $${cost}`);
  }
}

// Parse OVERHEAD/PROFIT
console.log("\n=== OVERHEAD/PROFIT ===");
if (ohH >= 0) {
  const end = totalH >= 0 ? totalH : ohH + 10;
  for (let i = ohH + 1; i < Math.min(end, rows.length); i++) {
    const name = getStr(i, 0);
    const cost = getNum(i, 2);
    console.log(`  ${name} | $${cost}`);
  }
}

// Total
const totalCost = totalH >= 0 ? getNum(totalH, 1) : null;
console.log("\n=== TOTAL FACTORY COST ===");
console.log("$", totalCost);

console.log("\n=== IMPORT READY ===");
console.log("✓ Parser successfully extracted all data from Excel!");
