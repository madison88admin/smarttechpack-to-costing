"use client";

import Link from "next/link";
import { useState } from "react";

export type SlaBreachRow = {
  id: string; request_number: string | null; owner_role: string | null; status: string;
  factory_name: string | null; started_at: string; days_in_status: number; sla_days: number | null;
  deadline_at: string | null; breached_at: string | null;
};

export function SlaBreachTable({ rows, statusLabels, role }: { rows: SlaBreachRow[]; statusLabels: Record<string, string>; role?: string }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / 5));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = rows.slice(currentPage * 5, (currentPage + 1) * 5);
  const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString() : "—";
  // The parent already scopes the table to the signed-in role. Repeating an
  // owner label implies cross-role visibility and adds no actionable detail.
  const showOwner = false;
  return <>
    <table className="table compact"><thead><tr><th>Request</th>{showOwner ? <th>Owner</th> : null}<th>Status</th><th>Factory</th><th>Started</th><th>Days in Status</th><th>SLA Limit</th><th>Deadline</th><th>Breached</th><th>Action</th></tr></thead>
      <tbody>{visible.map((r) => <tr key={r.id}><td><strong>{r.request_number ?? r.id.slice(0, 8)}</strong></td>{showOwner ? <td><span className="status blue">{(r.owner_role ?? "—").replace(/_/g, " ").toUpperCase()}</span></td> : null}<td><span className="status amber">{(statusLabels[r.status] ?? r.status).replace(/_/g, " ")}</span></td><td>{r.factory_name ?? "—"}</td><td className="eyebrow">{formatDate(r.started_at)}</td><td><strong className="text-red">{r.days_in_status}d</strong></td><td>{r.sla_days ? `${r.sla_days}d` : "—"}</td><td className="eyebrow">{formatDate(r.deadline_at)}</td><td className="eyebrow">{formatDate(r.breached_at)}</td><td><Link className="table-action" href={`/requests/${r.id}`}>Open</Link></td></tr>)}</tbody>
    </table>
    {pageCount > 1 ? <div className="pagination-controls"><button className="button secondary btn-sm" type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0}>Previous</button><span className="eyebrow">{currentPage * 5 + 1}–{Math.min((currentPage + 1) * 5, rows.length)} of {rows.length}</span><button className="button secondary btn-sm" type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage === pageCount - 1}>Next 5</button></div> : null}
  </>;
}
