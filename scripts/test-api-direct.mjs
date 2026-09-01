import fs from "fs";
import path from "path";

// Load env vars
const envPath = path.join(process.cwd(), ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// Import the findProfileUser logic
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

function verifyPassword(password, storedHash) {
  if (!storedHash?.startsWith("tpv1:")) return false;
  const [, storedIterations, salt, hash] = storedHash.split(":");
  const candidate = createHash("sha256").update(`${salt}:${storedIterations}:${password}`).digest("hex");
  return Buffer.from(candidate, "hex").length === Buffer.from(hash, "hex").length &&
         Buffer.from(candidate, "hex").every((v, i) => v === Buffer.from(hash, "hex")[i]);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY).schema("tp_costing");

const username = "factory@test.local";
const password = "factory";

console.log("Step 1: Check env vars");
console.log("  TP_COSTING_ENABLE_LEGACY_PASSWORD_LOGIN:", process.env.TP_COSTING_ENABLE_LEGACY_PASSWORD_LOGIN);

console.log("\nStep 2: Check username contains @");
console.log("  includes('@'):", username.includes("@"));

console.log("\nStep 3: Query user_profiles");
const { data, error } = await supabase
  .from("user_profiles")
  .select("id,display_name,email,role,is_active,password_hash")
  .eq("email", username)
  .eq("is_active", true)
  .maybeSingle();

if (error) {
  console.log("  ❌ Query error:", error.message);
} else if (!data) {
  console.log("  ❌ No user found");
} else {
  console.log("  ✅ User found:", data.email);
  
  console.log("\nStep 4: Verify password");
  const valid = verifyPassword(password, data.password_hash);
  console.log("  Password valid:", valid);
  
  if (valid) {
    console.log("\n✅ LOGIN WOULD SUCCEED!");
    console.log("  Role:", data.role);
  } else {
    console.log("\n❌ LOGIN WOULD FAIL - password mismatch");
  }
}
