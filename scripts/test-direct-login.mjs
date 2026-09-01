import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY).schema("tp_costing");

// Simulate what findProfileUser does
const username = "factory@test.local";
const password = "factory";

console.log("1. Querying user_profiles for:", username);
const { data, error } = await supabase
  .from("user_profiles")
  .select("id,display_name,email,role,is_active,password_hash")
  .eq("email", username)
  .eq("is_active", true)
  .maybeSingle();

if (error) {
  console.log("   ❌ Query error:", error.message);
} else if (!data) {
  console.log("   ❌ No user found");
} else {
  console.log("   ✅ User found:", data.email, data.role);
  console.log("   password_hash:", data.password_hash?.substring(0, 30) + "...");
  
  // Test password verification
  if (data.password_hash?.startsWith("tpv1:")) {
    const [, iterations, salt, hash] = data.password_hash.split(":");
    const candidate = createHash("sha256").update(`${salt}:${iterations}:${password}`).digest("hex");
    const valid = candidate === hash;
    console.log("   Password valid:", valid);
    
    if (!valid) {
      console.log("   Expected hash:", hash);
      console.log("   Got hash:", candidate);
    }
  } else {
    console.log("   ❌ Invalid password hash format:", data.password_hash?.substring(0, 20));
  }
}
