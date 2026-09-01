import Link from "next/link";
import { StatusPill } from "@/components/status-pill";
import { IconArrowRight, IconClock } from "@/components/ui/icons";
import type { CostingStatus } from "@/lib/workflow/status";

export type FactoryQueueRow = {
  id: string;
  request_number: string | null;
  factory_name: string | null;
  status: string;
  assigned_factory_user_id?: string | null;
  created_at: string;
  customer_status?: string | null;
  nextgen_products:
    | { style_number: string | null; name: string | null }
    | { style_number: string | null; name: string | null }[]
    | null;
};

type AgingInfo = { is_overdue: boolean; days_in_status: number; sla_days: number | null };

export function FactoryQueue({
  title,
  description,
  rows,
  agingById,
  emptyMessage
}: {
  title: string;
  description?: string;
  rows: FactoryQueueRow[];
  agingById: Map<string, AgingInfo>;
  emptyMessage: string;
}) {
  return (
    <section className="panel factory-queue-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Factory queue</p>
          <h2>{title}</h2>
          {description ? <p className="eyebrow">{description}</p> : null}
        </div>
        <span className="status blue">{rows.length} request{rows.length === 1 ? "" : "s"}</span>
      </div>
      {!rows.length ? (
        <div className="empty-state compact-empty"><strong>{emptyMessage}</strong></div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr><th>Request</th><th>Style</th><th>Status</th><th>Age</th><th>Action</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const product = Array.isArray(row.nextgen_products) ? row.nextgen_products[0] : row.nextgen_products;
                const aging = agingById.get(row.id);
                const editable = row.status === "sent_to_factory" || row.status === "needs_clarification" || row.status === "draft";
                return (
                  <tr key={row.id}>
                    <td><Link href={`/requests/${row.id}`} className="req-link"><strong>{row.request_number ?? row.id.slice(0, 8)}</strong></Link></td>
                    <td><strong>{product?.style_number ?? "Pending style"}</strong><span className="eyebrow">{product?.name ?? "NextGen product"}</span></td>
                    <td><StatusPill status={row.status as CostingStatus} /></td>
                    <td>
                      <span className={`age-badge ${aging?.is_overdue ? "age-red" : "age-neutral"}`}>
                        {aging?.is_overdue ? <IconClock size={12} /> : null} {aging?.days_in_status ?? 0}d
                      </span>
                      {aging?.is_overdue ? <small className="overdue-label">Overdue</small> : null}
                    </td>
                    <td><Link href={editable ? `/factory/${row.id}` : `/requests/${row.id}`} className="table-action primary-action">{editable ? "Open CBD" : "View"} <IconArrowRight size={14} /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
