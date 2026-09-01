import { NextResponse } from "next/server";

export function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export function upstreamJson(data: unknown) {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
