import fs from "fs";
import path from "path";

// Check env vars
const envPath = path.join(process.cwd(), ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

console.log("TP_COSTING_ENABLE_LEGACY_PASSWORD_LOGIN:", process.env.TP_COSTING_ENABLE_LEGACY_PASSWORD_LOGIN);

// Check the function logic
const username = "factory@test.local";
const password = "factory";

const legacyEnabled = process.env.TP_COSTING_ENABLE_LEGACY_PASSWORD_LOGIN === "true";
const hasAt = username.includes("@");
const shouldCallProfile = legacyEnabled && hasAt;

console.log("\nLogin flow:");
console.log("  legacyEnabled:", legacyEnabled);
console.log("  username includes @:", hasAt);
console.log("  shouldCallProfileUser:", shouldCallProfile);

if (!shouldCallProfile) {
  console.log("\n❌ findProfileUser would return null!");
  console.log("   Reason:", !legacyEnabled ? "TP_COSTING_ENABLE_LEGACY_PASSWORD_LOGIN is not 'true'" : "username doesn't contain @");
}
