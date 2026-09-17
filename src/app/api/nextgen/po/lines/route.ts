import { NextResponse } from "next/server";
import { canCreateRequest, getCurrentRole } from "@/lib/auth/roles";
import { fetchPurchaseOrderLines } from "@/lib/nextgen/po-lines";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!canCreateRequest(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Only PBD or administrators can load PO-line pricing references" }, { status: 403 });
  }

  const url = new URL(request.url);
  const poId = url.searchParams.get("poId")?.trim().toLocaleLowerCase() ?? "";
  const poNumber = url.searchParams.get("poNumber")?.trim().toLocaleLowerCase() ?? "";
  const result = await fetchPurchaseOrderLines();
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      error: "NextGen PO-line service is currently unavailable. The PO selection was kept, but product data was not auto-loaded.",
      upstreamStatus: result.status
    }, { status: 502 });
  }

  const lines = result.lines.filter((line) => {
    if (!poId && !poNumber) return true;
    const values = [line.id, line.poNumber, line.style, line.raw.OrderId, line.raw.PurchaseOrderId]
      .map((value) => String(value ?? "").trim().toLocaleLowerCase());
    return values.some((value) => (poId && value === poId) || (poNumber && value === poNumber));
  });
  const productIds = [...new Set(lines.map((line) => line.productId).filter((value): value is string => !!value))];
  const styles = [...new Set(lines.map((line) => line.style).filter((value): value is string => !!value))];
  // Raw PO payloads include commercial fields beyond the request form's
  // requirement. Keep those server-only; the browser receives the allowlisted
  // mapped values above, not a pass-through NextGen response.
  const safeLines = lines.map(({ raw: _raw, ...line }) => line);
  return NextResponse.json({ ok: true, lines: safeLines, productIds, styles, source: "NextGen PurchaseOrder/Read" });
}
