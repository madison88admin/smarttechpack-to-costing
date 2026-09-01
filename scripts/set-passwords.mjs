import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY).schema("tp_costing");

function hashPassword(password) {
  const iterations = 120000;
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${salt}:${iterations}:${password}`).digest("hex");
  return `tpv1:${iterations}:${salt}:${hash}`;
}

// Set passwords for test users
const passwordMap = {
  "superadmin@test.local": "superadmin",
  "admin@test.local": "admin",
  "pbd@test.local": "pbd",
  "costing@test.local": "costing",
  "factory@test.local": "factory",
  "viewer@test.local": "viewer",
  "md@test.local": "md",
  "tp.pbd@madison88.com": "pbd",
  "tp.factory@madison88.com": "factory",
  "tp.costing@madison88.com": "costing",
  "tp.admin@madison88.com": "admin",
  "tp.viewer@madison88.com": "viewer",
};

console.log("Setting passwords...\n");

for (const [email, password] of Object.entries(passwordMap)) {
  const hash = hashPassword(password);
  const { error } = await supabase
    .from("user_profiles")
    .update({ password_hash: hash })
    .eq("email", email);
  
  if (error) {
    console.log(`  ❌ ${email}: ${error.message}`);
  } else {
    console.log(`  ✅ ${email} -> password set to "${password}"`);
  }
}

console.log("\nDone! Passwords set for all test users.");
