import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const home = process.env.USERPROFILE || "";
const downloadsDir = path.join(home, "Downloads");
const files = fs.readdirSync(downloadsDir).filter(f => f.includes("79758") && f.endsWith(".xlsx"));
const filePath = path.join(downloadsDir, files[0]);

const buffer = fs.readFileSync(filePath);
const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

console.log("=== Debugging Operations (rows 24-35) ===");
for (let i = 24; i <= 35; i++) {
  const row = rows[i];
  if (!row) { console.log(`Row ${i}: (empty)`); continue; }
  const cells = row.slice(0, 6).map((c, j) => `[${j}]=${c === null ? "null" : JSON.stringify(String(c).substring(0, 30))}`);
  console.log(`Row ${i}:`, cells.join(" | "));
}

console.log("\n=== Debugging Packaging (rows 32-36) ===");
for (let i = 32; i <= 36; i++) {
  const row = rows[i];
  if (!row) { console.log(`Row ${i}: (empty)`); continue; }
  const cells = row.slice(0, 6).map((c, j) => `[${j}]=${c === null ? "null" : JSON.stringify(String(c).substring(0, 30))}`);
  console.log(`Row ${i}:`, cells.join(" | "));
}

console.log("\n=== Debugging Overhead (rows 36-42) ===");
for (let i = 36; i <= 42; i++) {
  const row = rows[i];
  if (!row) { console.log(`Row ${i}: (empty)`); continue; }
  const cells = row.slice(0, 6).map((c, j) => `[${j}]=${c === null ? "null" : JSON.stringify(String(c).substring(0, 30))}`);
  console.log(`Row ${i}:`, cells.join(" | "));
}

console.log("\n=== Debugging Trim (rows 13-18) ===");
for (let i = 13; i <= 18; i++) {
  const row = rows[i];
  if (!row) { console.log(`Row ${i}: (empty)`); continue; }
  const cells = row.slice(0, 6).map((c, j) => `[${j}]=${c === null ? "null" : JSON.stringify(String(c).substring(0, 30))}`);
  console.log(`Row ${i}:`, cells.join(" | "));
}
