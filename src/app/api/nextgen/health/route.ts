import { NextResponse } from "next/server";
import { getNextGenSessionCookie } from "@/lib/nextgen/session";

export async function GET() {
  try {
    const cookie = await getNextGenSessionCookie();

    return NextResponse.json({
      ok: true,
      authenticated: cookie.includes("FastReactAuthentication")
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "NextGen health check failed"
      },
      { status: 500 }
    );
  }
}
