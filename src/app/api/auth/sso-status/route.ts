import { NextResponse } from "next/server";
import { isSupabaseAuthEnabled } from "@/lib/auth/supabase-auth";

export async function GET() {
  return NextResponse.json({
    ok: true,
    supabaseAuthEnabled: isSupabaseAuthEnabled(),
    ssoProviderConfigured: Boolean(process.env.TP_COSTING_SSO_PROVIDER),
    provider: process.env.TP_COSTING_SSO_PROVIDER ?? null
  });
}
