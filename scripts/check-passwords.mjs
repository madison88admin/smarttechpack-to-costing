import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY).schema("tp_costing");

const { data: users } = await supabase
  .from("user_profiles")
  .select("email, role, password_hash")
  .limit(5);

console.log("\n=== Password Hashes ===");
for (const u of (users || [])) {
  const hash = u.password_hash || "null";
  console.log(`  ${u.email} (${u.role}): ${hash.substring(0, 50)}...`);
}
