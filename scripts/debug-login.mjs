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

// Get a user
const { data: user } = await supabase
  .from("user_profiles")
  .select("email, role, password_hash, is_active")
  .eq("email", "factory@test.local")
  .single();

console.log("User:", user);

// Test password verification
function hashPassword(password) {
  const iterations = 120000;
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${salt}:${iterations}:${password}`).digest("hex");
  return `tpv1:${iterations}:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash?.startsWith("tpv1:")) return false;
  const [, storedIterations, salt, hash] = storedHash.split(":");
  const candidate = createHash("sha256").update(`${salt}:${storedIterations}:${password}`).digest("hex");
  return candidate === hash;
}

// Generate new hash and test
const newHash = hashPassword("factory");
console.log("\nNew hash:", newHash);
console.log("Verify 'factory' against new hash:", verifyPassword("factory", newHash));

// Test stored hash
if (user?.password_hash) {
  console.log("\nStored hash:", user.password_hash);
  console.log("Verify 'factory' against stored hash:", verifyPassword("factory", user.password_hash));
}
