import { AppShell } from "@/components/app-shell";
import { CreateRequestForm } from "@/components/create-request-form";
import { canCreateRequest, getCurrentRole } from "@/lib/auth/roles";
import { getHistoricalCostingById } from "@/lib/costing/history";

export const dynamic = "force-dynamic";

export default async function NewRequestPage({
  searchParams
}: {
  searchParams?: { style?: string; baseline?: string };
}) {
  const role = getCurrentRole();

  // Optional historical baseline (?baseline=<historical id>): a comparable
  // approved costing whose cost/attributes prefill the new request.
  const baselineId = searchParams?.baseline?.trim() ?? "";
  let baseline = null;
  if (baselineId) {
    try {
      baseline = await getHistoricalCostingById(baselineId);
    } catch {
      baseline = null;
    }
  }

  const initialStyle = baseline?.style_number ?? searchParams?.style ?? "";

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Create Request</p>
          <h1>Pull Style Data From NextGen</h1>
        </div>
      </div>

      <div className="step-list">
        <div className="step current">1. Search NextGen</div>
        <div className="step">2. Review BOM</div>
        <div className="step">3. Send to Factory</div>
        <div className="step">4. Validate CBD</div>
        <div className="step">5. PBD Approval</div>
      </div>

      {canCreateRequest(role) ? (
        <div className="split">
          <CreateRequestForm initialStyle={initialStyle} baseline={baseline} />

          <aside className="panel">
            <h2>What Gets Prefilled</h2>
            <ul className="list">
              <li>Style number and product name</li>
              <li>Product options and colorways</li>
              <li>BOM material lines</li>
              <li>PO/MPO references when available</li>
              <li>Factory only fills missing costing values</li>
              {baseline ? <li className="eyebrow">Baseline from historical costing {baseline.style_number ?? ""}</li> : null}
            </ul>
          </aside>
        </div>
      ) : (
        <section className="panel">
          <p className="notice">Your role can view requests, but cannot create new costing requests.</p>
        </section>
      )}
    </AppShell>
  );
}
