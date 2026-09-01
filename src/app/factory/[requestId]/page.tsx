import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { FactoryCbdForm } from "@/components/factory-cbd-form";
import { CbdImportUpload } from "@/components/cbd-import-upload";
import { canSubmitFactoryCbd, getCurrentRole, getCurrentUserId } from "@/lib/auth/roles";
import { resolveFactoryProfileId } from "@/lib/admin/assignments";
import { tryGetCostingRequest } from "@/lib/costing/requests";
import { IconArrowRight } from "@/components/ui/icons";

function getProduct(request: Awaited<ReturnType<typeof tryGetCostingRequest>>["data"]) {
  if (!request?.nextgen_products) return null;
  return Array.isArray(request.nextgen_products) ? request.nextgen_products[0] : request.nextgen_products;
}

export default async function FactoryRequestPage({ params }: { params: { requestId: string } }) {
  const role = getCurrentRole();
  const { data, error } = await tryGetCostingRequest(params.requestId);
  const factoryProfileId = role === "factory"
    ? await resolveFactoryProfileId(getCurrentUserId()).catch(() => null)
    : null;
  const product = getProduct(data);
  const bomLines = product?.nextgen_bom_lines ?? [];
  const latestCbd = data?.factory_cbds?.[0] ?? null;
  const latestClarification = data?.approval_actions?.find((action) => action.action === "clarify");
  const status = data?.status ?? "draft";
  const factoryAssigned = Boolean(factoryProfileId && data?.assigned_factory_user_id === factoryProfileId);
  const factoryCanAccess = role !== "factory" || factoryAssigned;
  const canEdit = canSubmitFactoryCbd(role) && (status === "sent_to_factory" || status === "needs_clarification" || status === "draft");
  const hasNoCbd = !latestCbd;

  const prefill = {
    customer: (data as any)?.customer_name ?? undefined,
    season: (data as any)?.season ?? undefined,
    styleNumber: product?.style_number ?? undefined,
    styleName: product?.name ?? undefined,
  };

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">{data?.request_number ?? params.requestId}</p>
          <h1>{product?.style_number ?? "Factory CBD"}</h1>
        </div>
        <Link className="button secondary" href={`/requests/${params.requestId}`}>View Request</Link>
      </div>

      {error ? (
        <section className="panel">
          <p className="notice">Unable to load live request: {error}</p>
        </section>
      ) : !factoryCanAccess ? (
        <section className="panel">
          <h2>Request not assigned to you</h2>
          <p className="notice">This factory request is restricted to its assigned factory user. Ask an admin or PBD user to assign it before opening the CBD workspace.</p>
          <Link className="button secondary" href="/factory">Back to Factory Queue</Link>
        </section>
      ) : (
        <>
          {latestClarification ? (
            <section className="panel clarification-panel">
              <h2>Clarification Request</h2>
              <p>{latestClarification.comment ?? "PBD requested clarification."}</p>
            </section>
          ) : null}
          {!canSubmitFactoryCbd(role) ? (
            <>
              <section className="panel">
                <div className="toolbar">
                  <span className={`status ${status === "approved" ? "green" : status === "rejected" ? "red" : "blue"}`}>{status.toUpperCase()}</span>
                  <span className="eyebrow">Read-only view</span>
                </div>
              </section>
              <FactoryCbdForm requestId={params.requestId} bomLines={bomLines} existingCbd={latestCbd} readOnly prefill={prefill} baselineRef={data?.baseline_ref} />
            </>
          ) : !canEdit ? (
            <>
              <section className="panel">
                <div className="toolbar">
                  <span className={`status ${status === "approved" ? "green" : status === "rejected" ? "red" : "blue"}`}>{status.toUpperCase()}</span>
                  <span className="eyebrow">No longer editable</span>
                </div>
              </section>
              <FactoryCbdForm requestId={params.requestId} bomLines={bomLines} existingCbd={latestCbd} readOnly prefill={prefill} baselineRef={data?.baseline_ref} />
            </>
          ) : (
            <>
              {hasNoCbd && <CbdImportUpload requestId={params.requestId} />}
              <FactoryCbdForm requestId={params.requestId} bomLines={bomLines} existingCbd={latestCbd} prefill={prefill} baselineRef={data?.baseline_ref} />
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
