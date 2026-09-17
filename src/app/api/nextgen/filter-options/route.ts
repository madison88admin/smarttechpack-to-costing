import { NextResponse } from "next/server";
import { getNextGenFilterOptions } from "@/lib/nextgen/filter-options";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET() {
  const role = getCurrentRole();
  if (role === "viewer") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const data = await getNextGenFilterOptions();
    return NextResponse.json({ ok: true, ...data });
  } catch {
    return NextResponse.json({ ok: false, error: "NextGen directory is unavailable. Historical filters remain available." }, { status: 503 });
  }
}
