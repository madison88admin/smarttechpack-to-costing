import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import fs from "fs";

const envPath = process.cwd() + "/.env.local";
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY).schema("tp_costing");

// Check viewer
const { data: viewer } = await supabase.from("user_profiles").select("email, password_hash, is_active").eq("email", "tp.viewer@madison88.com").single();
console.log("Viewer:", viewer);

// Set password
const iterations = 120000;
const salt = randomBytes(16).toString("hex");
const hash = createHash("sha256").update(`${salt}:${iterations}:viewer`).digest("hex");
const pw = `tpv1:${iterations}:${salt}:${hash}`;
const { error } = await supabase.from("user_profiles").update({ password_hash: pw }).eq("email", "tp.viewer@madison88.com");
console.log("Set viewer password:", error ? error.message : "OK");
