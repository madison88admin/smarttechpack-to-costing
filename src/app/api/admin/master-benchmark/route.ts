import { NextResponse } from "next/server";
import { canCurateMasterBenchmarks, getCurrentRole, getCurrentUserName } from "@/lib/auth/roles";
import { listCuratedBenchmarks, saveCuratedBenchmark } from "@/lib/costing/master-benchmark";
import { reflagRequestsForBenchmarkChange } from "@/lib/costing/benchmark-reflag";

export async function GET() {
  if (!canCurateMasterBenchmarks(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "MD, Costing, PBD, or admin access required" }, { status: 403 });
  }

  const result = await listCuratedBenchmarks();
  if (result.error) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, data: result.data });
}

const CATEGORIES = ["material", "operation", "knitting"] as const;

export async function POST(request: Request) {
  if (!canCurateMasterBenchmarks(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "MD, Costing, PBD, or admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const label = typeof body?.label === "string" ? body.label.trim().replace(/\s+/g, " ") : "";
  const category = CATEGORIES.find((c) => c === body?.category);

  if (!label || !category) {
    return NextResponse.json({ ok: false, error: "label and category are required" }, { status: 400 });
  }

  const toNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value.replace(/,/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const result = await saveCuratedBenchmark({
    id: typeof body?.id === "string" ? body.id : null,
    label,
    category,
    curatedAverage: toNumber(body?.curatedAverage),
    curatedMedian: toNumber(body?.curatedMedian),
    curatedMax: toNumber(body?.curatedMax),
    isTime: body?.isTime === true || body?.isTime === "true",
    notes: typeof body?.notes === "string" ? body.notes : null,
    isActive: body?.isActive !== false,
    updatedBy: getCurrentUserName() ?? getCurrentRole()
  });

  if (result.error) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  // Re-flag active requests whose submitted lines are now over the updated
  // benchmark. Best-effort — never blocks the save on notification failures.
  if (result.data) {
    const previous = result.previous;
    const prevAverage =
      previous?.curated_average === null || previous?.curated_average === undefined
        ? null
        : Number(previous.curated_average);
    reflagRequestsForBenchmarkChange({
      label: result.data.label,
      category: result.data.category,
      oldAverage: Number.isFinite(prevAverage ?? NaN) ? prevAverage : null,
      newAverage: result.data.curated_average === null ? null : Number(result.data.curated_average),
      changedBy: getCurrentUserName() ?? getCurrentRole(),
      notes: result.data.notes
    }).catch(() => {
      // Best-effort — the save already succeeded.
    });
  }

  return NextResponse.json({ ok: true, data: result.data });
}
