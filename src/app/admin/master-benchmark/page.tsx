import { AppShell } from "@/components/app-shell";
import { MasterBenchmarkEditor } from "@/components/master-benchmark-editor";
import { canCurateMasterBenchmarks, getCurrentRole } from "@/lib/auth/roles";
import { listBenchmarkHistory } from "@/lib/costing/master-benchmark";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default async function MasterBenchmarkAdminPage() {
  const role = getCurrentRole();

  if (!canCurateMasterBenchmarks(role)) {
    return (
      <AppShell>
        <section className="panel">
          <div className="empty-state">
            <strong>Access Denied</strong>
            <p>Your role ({role}) does not have access to master benchmark curation.</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const history = await listBenchmarkHistory({ limit: 25 });
  const historyUnavailable = Boolean(history.error && /does not exist|schema cache|relation/i.test(history.error));

  return (
    <AppShell>
      <div className="hero">
        <div>
          <p className="eyebrow">MD / Costing reference data</p>
          <h1>Master Material Benchmark</h1>
          <p>Curate reference prices, operation costs, and knitting times that override the auto-derived benchmark in MD review.</p>
        </div>
      </div>
      <MasterBenchmarkEditor />

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Price change archive — who moved a reference, from what to what</p>
            <h2>Benchmark Price History</h2>
          </div>
          <span className="status blue">{history.data.length} recorded change{history.data.length === 1 ? "" : "s"}</span>
        </div>
        {historyUnavailable ? (
          <p className="notice">
            Price history is unavailable: the <code>master_benchmark_history</code> table is not migrated yet.
            Apply <code>database/migrations/008_master_benchmark_history.sql</code> (docker exec -i supabase-db psql -U postgres -d postgres -f ...) to start recording changes. Benchmark saves and re-flagging still work.
          </p>
        ) : history.data.length === 0 ? (
          <p className="eyebrow">No price changes recorded yet. Changes are archived automatically on every save.</p>
        ) : (
          <div className="table-wrapper">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Changed</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Previous</th>
                  <th>New</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((row) => {
                  const unit = row.is_time ? " min" : "";
                  const prev = [row.prev_average, row.prev_median, row.prev_max]
                    .filter((value) => value !== null)
                    .map((value) => `${value}${unit}`)
                    .join(" / ") || "— (new)";
                  const next = [row.new_average, row.new_median, row.new_max]
                    .filter((value) => value !== null)
                    .map((value) => `${value}${unit}`)
                    .join(" / ");
                  return (
                    <tr key={row.id}>
                      <td className="eyebrow">{formatDate(row.created_at)}</td>
                      <td>
                        <strong>{row.label}</strong>
                        {row.notes ? <><br /><span className="eyebrow">{row.notes}</span></> : null}
                      </td>
                      <td><span className="status blue">{row.category}</span></td>
                      <td className="eyebrow">{prev}</td>
                      <td><strong>{next}</strong></td>
                      <td className="eyebrow">{row.changed_by ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
