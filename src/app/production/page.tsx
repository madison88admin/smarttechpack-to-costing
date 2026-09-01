import { AppShell } from "@/components/app-shell";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { canAccessInternalCostData, getCurrentRole } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import { calculateCostingTotals } from "@/lib/costing/totals";
import Link from "next/link";
import { IconCheck } from "@/components/ui/icons";

// This page depends on authenticated runtime identity and the live database.
// Prevent Next.js from querying Supabase during the container image build.
export const dynamic = "force-dynamic";

type ApprovedRequest = {
  id: string;
  request_number: string | null;
  factory_name: string | null;
  approved_at: string | null;
  updated_at: string;
  cost_sheet_ready: boolean | null;
  cost_sheet_ready_at: string | null;
  nextgen_products: unknown;
  factory_cbds: unknown;
};

export default async function ProductionPage() {
  const supabase = createSupabaseServiceClient();
  const role = getCurrentRole();
  if (!canAccessInternalCostData(role)) redirect("/");

  const { data, error } = await supabase
    .from("costing_requests")
    .select(
      `
      id,
      request_number,
      factory_name,
      updated_at,
      cost_sheet_ready,
      cost_sheet_ready_at,
      nextgen_products (style_number, name),
      factory_cbds (raw_payload, cbd_material_lines (material_name, unit_cost, total_cost, currency))
    `
    )
    .eq("status", "approved")
    .order("updated_at", { ascending: false })
    .limit(100);

  const requests = (data ?? []) as unknown as ApprovedRequest[];

  return (
    <AppShell>
      <div className="hero">
        <div>
          <p className="eyebrow">Production Team</p>
          <h1>Approved Costings</h1>
          <p className="hero-copy">
            Approved costing data for production planning. All CBDs listed here have passed PBD review and are ready for production.
          </p>
        </div>
      </div>

      {error ? <p className="notice">Unable to load approved costings: {error.message}</p> : null}

      {!error && requests.length === 0 ? (
        <div className="empty-state">
          <strong>No approved costings yet</strong>
          <p>Approved requests will appear here for production team visibility.</p>
        </div>
      ) : null}

      <div className="production-grid">
        {requests.map((req) => {
          const product = Array.isArray(req.nextgen_products)
            ? req.nextgen_products[0]
            : req.nextgen_products;
          const cbd = Array.isArray(req.factory_cbds) ? req.factory_cbds[0] : req.factory_cbds;
          const payload = (cbd?.raw_payload ?? {}) as Record<string, unknown>;
          const materialLines = (cbd?.cbd_material_lines ?? []) as Array<{
            material_name: string | null;
            unit_cost: number | null;
            total_cost: number | null;
            currency: string | null;
          }>;
          const totals = calculateCostingTotals({
            rawPayload: cbd?.raw_payload,
            lines: materialLines.map((line) => ({
              total_cost: line.total_cost,
              currency: line.currency
            }))
          });

          return (
            <div key={req.id} className="production-card">
              <h4>
                <Link href={`/requests/${req.id}`}>
                  {product?.style_number ?? "Unknown Style"}
                </Link>
                {req.cost_sheet_ready ? (
                  <span className="readiness-badge ready" style={{ marginLeft: 8, fontSize: "0.7rem", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <IconCheck size={12} /> NextGen Ready
                  </span>
                ) : (
                  <span className="readiness-badge pending" style={{ marginLeft: 8, fontSize: "0.7rem" }}>
                    Pending NextGen
                  </span>
                )}
              </h4>
              <div className="production-meta">
                <span>Request: {req.request_number ?? "—"}</span>
                <span>Factory: {req.factory_name ?? "—"}</span>
                <span>Product: {product?.name ?? "—"}</span>
                <span>Approved: {new Date(req.updated_at).toLocaleDateString()}</span>
                <span>MOQ: {String(payload.moq ?? "—")}</span>
                <span>Lead Time: {String(payload.leadTimeDays ?? "—")} days</span>
                <span>
                  <strong>Total Cost: {totals.currency} {totals.grandTotal.toFixed(2)}</strong>
                </span>
                <span>Materials: {totals.currency} {totals.materialTotal.toFixed(2)}</span>
                <span>Labor: {totals.currency} {totals.laborCost.toFixed(2)}</span>
                <span>Yarn: {String(payload.yarnType ?? "—")}</span>
                <span>Knit: {String(payload.knitType ?? "—")}</span>
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
