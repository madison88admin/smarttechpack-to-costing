import { createClient } from "@supabase/supabase-js";

export function createSupabaseAuthClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_PUBLIC_URL ??
    process.env.API_EXTERNAL_URL ??
    "http://supabase-kong:8000";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.ANON_KEY;

  if (!supabaseUrl || !anonKey) return null;

  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function isSupabaseAuthEnabled() {
  return process.env.TP_COSTING_ENABLE_SUPABASE_AUTH === "true";
}
