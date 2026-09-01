import fs from "fs";

const envPath = process.cwd() + "/.env.local";
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

console.log("SUPABASE_URL:", process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 30) + "...");
console.log("SUPABASE_ANON_KEY:", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "SET" : "NOT SET");
console.log("SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "SET" : "NOT SET");
console.log("LEGACY_LOGIN:", process.env.TP_COSTING_ENABLE_LEGACY_PASSWORD_LOGIN);

// Check if Supabase Auth is enabled
const SUPABASE_AUTH_ENABLED = !!(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
console.log("\nSupabase Auth enabled:", SUPABASE_AUTH_ENABLED);
