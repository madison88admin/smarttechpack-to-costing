import { NextResponse } from "next/server";
import { canRunPbdAction, getCurrentRole } from "@/lib/auth/roles";
import { detectAnomalies } from "@/lib/analytics/anomaly-detection";

// GET /api/analytics/anomalies — detect and return cost anomalies
export async function GET() {
  const role = getCurrentRole();
  if (!canRunPbdAction(role)) {
    return NextResponse.json({ ok: false, error: "PBD or admin access required" }, { status: 403 });
  }

  try {
    const result = await detectAnomalies();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Anomaly detection failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
