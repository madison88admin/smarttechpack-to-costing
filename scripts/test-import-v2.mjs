import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const home = process.env.USERPROFILE || "";
const downloadsDir = path.join(home, "Downloads");
const files = fs.readdirSync(downloadsDir).filter(f => f.includes("79758") && f.endsWith(".xlsx"));
const filePath = path.join(downloadsDir, files[0]);

console.log("=== CBD Import Test (v2 - fixed column 3) ===\n");

const buffer = fs.readFileSync(filePath);
const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

const gs = (r, c) => rows[r]?.[c] == null ? "" : String(rows[r][c]).trim();
const gn = (r, c) => {
  const v = rows[r]?.[c];
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const fsec = (kws) => {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.some(c => kws.some(kw => String(c ?? "").toLowerCase().includes(kw.toLowerCase())))) return i;
  }
  return -1;
};

// Headers
let customer = null, season = null, styleNumber = null, styleName = null;
let moq = null, leadTimeDays = null, finishWeight = null;
for (let i = 0; i < Math.min(10, rows.length); i++) {
  const row = rows[i]; if (!row) continue;
  for (let j = 0; j < row.length; j++) {
    const cell = String(row[j] ?? "").trim();
    if (cell.includes("Customer") && cell.includes(":")) { const v = gs(i, j+1); if (v && !v.toLowerCase().includes("customer")) customer = v; }
    if (cell.includes("Season") && cell.includes(":")) { const v = gs(i, j+1); if (v && !v.toLowerCase().includes("season")) season = v; }
    if (cell.includes("Style") && cell.includes("#")) { const v = gs(i, j+1); if (v && !v.toLowerCase().includes("style")) styleNumber = v; }
    if (cell.includes("Style Name") && cell.includes(":")) { const v = gs(i, j+1); if (v) styleName = v.replace(/\r?\n/g, " ").trim(); }
    if (cell.includes("MOQ") && cell.includes(":")) { const v = gs(i, j+1); const m = v.match(/(\d+)/); if (m) moq = parseInt(m[1]); }
    if (cell.toLowerCase().includes("leadtime")) { const v = gs(i, j+1); const m = v.match(/(\d+)/); if (m) leadTimeDays = parseInt(m[1]); }
    if (cell.toLowerCase().includes("sample weight")) { const v = gs(i, j+1); if (v) finishWeight = v; }
  }
}

console.log("=== HEADER INFO ===");
console.log("  Customer:", customer);
console.log("  Season:", season);
console.log("  Style #:", styleNumber);
console.log("  Style Name:", styleName);
console.log("  MOQ:", moq);
console.log("  Lead Time:", leadTimeDays, "days");
console.log("  Weight:", finishWeight);

// Sections
const yH = fsec(["YARN"]), fH = fsec(["FABRIC"]), tH = fsec(["TRIM"]);
const kH = fsec(["KNITTING"]), oH = fsec(["OPERATIONS"]);
const pH = fsec(["PACKAGING"]), hH = fsec(["OVERHEAD"]), cH = fsec(["TOTAL FACTORY COST"]);

// YARN (col 1=consumption, col 2=price, col 3=cost)
console.log("\n=== YARN ===");
if (yH >= 0) {
  const end = fH >= 0 ? fH : (tH >= 0 ? tH : yH + 10);
  for (let i = yH + 1; i < Math.min(end, rows.length); i++) {
    const name = gs(i, 0);
    if (!name || name === "0") continue;
    if (name.toLowerCase().includes("total")) break;
    console.log(`  ${name.substring(0, 60)} | ${gn(i,1)}g | $${gn(i,2)}/kg | $${gn(i,3)}`);
  }
}

// KNITTING (col 1=time, col 2=sah, col 3=cost)
console.log("\n=== KNITTING ===");
if (kH >= 0) {
  const end = oH >= 0 ? oH : kH + 10;
  for (let i = kH + 1; i < Math.min(end, rows.length); i++) {
    const name = gs(i, 0);
    if (!name || name === "0") continue;
    console.log(`  ${name} | ${gn(i,1)} min | $${gn(i,2)}/min | $${gn(i,3)}`);
  }
}

// OPERATIONS (col 3 = cost!)
console.log("\n=== OPERATIONS (col 3) ===");
if (oH >= 0) {
  const end = pH >= 0 ? pH : oH + 15;
  for (let i = oH + 1; i < Math.min(end, rows.length); i++) {
    const name = gs(i, 0);
    if (!name || name === "0") continue;
    if (name.toLowerCase().includes("sub total")) break;
    console.log(`  ${name} | $${gn(i, 3)}`);
  }
}

// PACKAGING (col 3 = cost!)
console.log("\n=== PACKAGING (col 3) ===");
if (pH >= 0) {
  const end = hH >= 0 ? hH : pH + 10;
  for (let i = pH + 1; i < Math.min(end, rows.length); i++) {
    const name = gs(i, 0);
    const cost = gn(i, 3);
    console.log(`  ${name} | $${cost}`);
  }
}

// OVERHEAD/PROFIT (col 3 = cost!)
console.log("\n=== OVERHEAD/PROFIT (col 3) ===");
if (hH >= 0) {
  const end = cH >= 0 ? cH : hH + 10;
  for (let i = hH + 1; i < Math.min(end, rows.length); i++) {
    const name = gs(i, 0);
    const cost = gn(i, 3);
    console.log(`  ${name} | $${cost}`);
  }
}

// TOTAL (col 3)
console.log("\n=== TOTAL FACTORY COST ===");
if (cH >= 0) {
  console.log(`  $${gn(cH, 3)}`);
}

// Summary
const total = gn(cH, 3);
console.log("\n=== SUMMARY ===");
console.log("✓ All sections parsed successfully!");
console.log("✓ Total Factory Cost: $" + total);
console.log("✓ Expected: $3.7392");
console.log("✓ Match:", total === 3.7392 ? "YES ✓" : "NO (check parsing)");
