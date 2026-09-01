import { NextResponse } from "next/server";
import { tryGetNextGenFilterOptions } from "@/lib/nextgen/filter-options";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET() {
  const role = getCurrentRole();
  if (role === "viewer") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const data = await tryGetNextGenFilterOptions();
  return NextResponse.json({ ok: true, ...data });
}
