import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const home = process.env.USERPROFILE || "";
const files = fs.readdirSync(path.join(home, "Downloads")).filter(f => f.includes("79758") && f.endsWith(".xlsx"));
const filePath = path.join(home, "Downloads", files[0]);
const buffer = fs.readFileSync(filePath);
const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });

console.log("=== Row 0 raw cells ===");
for (let j = 0; j < 10; j++) {
  const v = rows[0]?.[j];
  console.log(`  [${j}]: ${v === null ? "null" : JSON.stringify(String(v))} (type: ${typeof v})`);
}

console.log("\n=== Row 1 raw cells ===");
for (let j = 0; j < 10; j++) {
  const v = rows[1]?.[j];
  console.log(`  [${j}]: ${v === null ? "null" : JSON.stringify(String(v))} (type: ${typeof v})`);
}

// Test: Does "Customer：" contain the colon?
const cell0_1 = String(rows[0]?.[1] ?? "");
console.log("\n=== Customer cell test ===");
console.log("Cell value:", JSON.stringify(cell0_1));
console.log("Includes ':' (regular):", cell0_1.includes(":"));
console.log("Includes '：' (fullwidth):", cell0_1.includes("\uff1a"));
console.log("Char codes:", [...cell0_1].map(c => c.charCodeAt(0).toString(16)));
