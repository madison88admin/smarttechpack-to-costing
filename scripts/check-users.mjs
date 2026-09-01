import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Read env
const envPath = path.join(process.cwd(), ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(url, key).schema("tp_costing");

const { data: users, error } = await supabase
  .from("user_profiles")
  .select("id, display_name, email, role, is_active")
  .order("created_at");

if (error) {
  console.error("Error:", error.message);
  process.exit(1);
}

console.log("\n=== User Profiles ===");
if (!users || users.length === 0) {
  console.log("No users found in database!");
  console.log("\nYou need to create users first. Run:");
  console.log("  node scripts/seed-users.mjs");
} else {
  console.log(`Found ${users.length} users:\n`);
  for (const u of users) {
    console.log(`  ${u.is_active ? "✅" : "❌"} ${u.role.padEnd(12)} | ${u.email || "no email"} | ${u.display_name}`);
  }
}
