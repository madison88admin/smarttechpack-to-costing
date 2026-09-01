import { NextRequest, NextResponse } from "next/server";
import { parseCbdExcel, parseCbdFile, validateParsedCbd } from "@/lib/costing/import-cbd-excel";
import { submitFactoryCbd } from "@/lib/costing/cbd";
import { getCurrentRole, getCurrentUserId } from "@/lib/auth/roles";
import { factoryOwnsRequest } from "@/lib/admin/assignments";

export async function POST(request: NextRequest) {
  try {
    const role = await getCurrentRole();
    if (!role || !["factory", "admin"].includes(role)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const costingRequestId = formData.get("costingRequestId") as string | null;
    const status = (formData.get("status") as string) || "draft";
    const autoSubmit = formData.get("autoSubmit") === "true";

    if (!file) {
      return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
    }
    if (!costingRequestId) {
      return NextResponse.json({ ok: false, error: "costingRequestId is required" }, { status: 400 });
    }
    if (role === "factory" && !(await factoryOwnsRequest(getCurrentUserId(), costingRequestId))) {
      return NextResponse.json({ ok: false, error: "Request is not assigned to this Factory user" }, { status: 403 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name || "upload.xlsx";
    const ext = fileName.toLowerCase().split(".").pop();
    const isPdf = ext === "pdf" || buffer.slice(0, 4).toString() === "%PDF";
    if (buffer.length > 10 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "File too large — max 10 MB. Please reduce file size." }, { status: 400 });
    }
    if (ext && !["xlsx", "xls", "csv", "pdf"].includes(ext)) {
      return NextResponse.json({ ok: false, error: `Unsupported file type .${ext} — please upload .xlsx, .xls or .pdf.` }, { status: 400 });
    }
    let parsedData;
    try {
      if (isPdf) {
        parsedData = await parseCbdFile(buffer, fileName);
      } else {
        parsedData = parseCbdExcel(buffer, fileName);
      }
    } catch (e) {
      return NextResponse.json({ ok: false, error: `Failed to parse: ${e instanceof Error ? e.message : "Unknown"}` }, { status: 400 });
    }

    const validation = validateParsedCbd(parsedData);
    let submitResult = null;

    if (autoSubmit && validation.isValid) {
      try {
        submitResult = await submitFactoryCbd({
          costingRequestId,
          status: status as "draft" | "submitted",
          currency: "USD",
          customer: parsedData.customer,
          season: parsedData.season,
          styleNumber: parsedData.styleNumber,
          styleName: parsedData.styleName,
          yarnLines: parsedData.yarnLines.map(l => ({
            name: l.name, consumption: l.consumption,
            materialPrice: l.materialPrice, materialCost: l.materialCost,
            fobPrice: "", surchargePercent: "", freightCost: "", markupPercent: ""
          })),
          fabricLines: parsedData.fabricLines,
          trimLines: parsedData.trimLines,
          knittingLines: parsedData.knittingLines,
          operationsLines: parsedData.operationsLines,
          lines: []
        });
      } catch (e) {
        return NextResponse.json({ ok: false, error: `Submit failed: ${e instanceof Error ? e.message : "Unknown"}`, parsedData, validation }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, parsedData, validation, submitResult });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Internal error" }, { status: 500 });
  }
}
