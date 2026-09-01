import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const checks: Record<string, string> = {
    app: "ok"
  };

  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("costing_requests").select("id", { count: "exact", head: true });
    checks.database = error ? `error:${error.code ?? error.message}` : "ok";
  } catch (error) {
    checks.database = error instanceof Error ? `error:${error.message}` : "error";
  }

  const ok = Object.values(checks).every((value) => value === "ok");

  return NextResponse.json({ ok, checks, timestamp: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
