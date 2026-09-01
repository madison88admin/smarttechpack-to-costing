import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const home = process.env.USERPROFILE || process.env.HOME || "";
const downloadsDir = path.join(home, "Downloads");

// Find the file - match "79758" in filename
const files = fs.readdirSync(downloadsDir).filter(f => f.includes("79758") && f.endsWith(".xlsx"));
console.log("Matching files:", files);

if (files.length === 0) {
  process.exit(1);
}

const filePath = path.join(downloadsDir, files[0]);
console.log("\nParsing:", filePath);

const buffer = fs.readFileSync(filePath);
const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

console.log("\nSheets:", workbook.SheetNames);

for (const sn of workbook.SheetNames) {
  const sheet = workbook.Sheets[sn];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  console.log(`\n=== Sheet: "${sn}" (${rows.length} rows) ===`);
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const nonEmpty = row.filter(c => c !== null && String(c).trim());
    if (nonEmpty.length > 0) {
      const summary = nonEmpty.slice(0, 8).map(c => String(c).substring(0, 45)).join(" | ");
      console.log(`Row ${String(i).padStart(3)}: ${summary}`);
    }
  }
}
