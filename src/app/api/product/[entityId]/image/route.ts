import { NextResponse } from "next/server";
import { fetchProductImage, type ProductImageResult } from "@/lib/nextgen/client";
import { getCurrentIdentity } from "@/lib/auth/roles";

export const revalidate = 600; // Cache for 10 minutes

// Map a failed fetch to an HTTP response. The rule: an upstream problem
// (NextGen down, bad credentials, misconfiguration) must never masquerade as
// a missing image (404) or a generic server error (500) — those get 502 Bad
// Gateway with a clear message, and the real cause is always logged first.
function imageErrorResponse(
  entityId: string,
  result: Extract<ProductImageResult, { ok: false }>
): NextResponse {
  switch (result.reason) {
    case "not-found":
      return NextResponse.json({ ok: false, error: "Image not found" }, { status: 404 });

    case "login-failed":
      console.error(`[image] entity ${entityId}: NextGen login failed — ${result.detail}`);
      return NextResponse.json(
        {
          ok: false,
          error:
            "NextGen login failed — product images unavailable. Check NEXTGEN_USERNAME/NEXTGEN_PASSWORD in the server configuration (details in the server log)."
        },
        { status: 502 }
      );

    case "not-configured":
      console.error(`[image] entity ${entityId}: NextGen not configured — ${result.detail}`);
      return NextResponse.json(
        { ok: false, error: `NextGen is not configured: ${result.detail}` },
        { status: 502 }
      );

    case "upstream":
      console.error(`[image] entity ${entityId}: NextGen upstream error — ${result.detail}`);
      return NextResponse.json(
        { ok: false, error: `NextGen image endpoint failed: ${result.detail}` },
        { status: 502 }
      );
  }
}

export async function GET(_: Request, context: { params: { entityId: string } }) {
  // Product images are read-only and should be available to every
  // authenticated role, including Viewer. Previously Viewer was treated as
  // unauthenticated here, so valid detail pages rendered without images.
  if (!getCurrentIdentity()) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  const entityId = context.params.entityId;
  if (!entityId) {
    return NextResponse.json({ ok: false, error: "Missing entityId" }, { status: 400 });
  }

  try {
    const result = await fetchProductImage(entityId);
    if (!result.ok) return imageErrorResponse(entityId, result);

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=600, s-maxage=600",
        "Content-Length": String(result.buffer.length)
      }
    });
  } catch (error) {
    console.error(`[image] entity ${entityId}: unexpected error —`, error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to fetch product image" },
      { status: 500 }
    );
  }
}
