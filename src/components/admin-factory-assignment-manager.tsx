"use client";

import { useMemo, useState } from "react";
import type { FactoryAssignmentRequest, FactoryAssignmentUser } from "@/lib/admin/assignments";
import { statusLabels, type CostingStatus } from "@/lib/workflow/status";

export function AdminFactoryAssignmentManager({
  users,
  requests
}: {
  users: FactoryAssignmentUser[];
  requests: FactoryAssignmentRequest[];
}) {
  const [query, setQuery] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string>>(
    Object.fromEntries(requests.map((request) => [request.id, request.assigned_factory_user_id ?? ""]))
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const visibleRequests = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return requests;
    return requests.filter((request) => {
      const product = Array.isArray(request.nextgen_products) ? request.nextgen_products[0] : request.nextgen_products;
      return [request.request_number, request.factory_name, product?.style_number, product?.name, request.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [query, requests]);

  async function save(requestId: string) {
    setBusyId(requestId);
    setMessage("Saving assignment...");
    try {
      const response = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, factoryUserId: assignments[requestId] || null })
      });
      const result = await response.json();
      setMessage(response.ok && result.ok ? "Assignment saved" : result.error ?? "Unable to save assignment");
    } catch {
      setMessage("Network error — please try again");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid">
      <div className="toolbar filter-toolbar">
        <input
          className="input search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search request, style, or factory..."
          aria-label="Search factory assignments"
        />
        <span className="eyebrow">{requests.length} active request{requests.length === 1 ? "" : "s"} · {users.length} active factory user{users.length === 1 ? "" : "s"}</span>
      </div>

      {!users.length ? <p className="notice">No active users with the Factory role. Add or activate a Factory user first.</p> : null}
      <div className="table-wrapper">
        <table className="table compact">
          <thead><tr><th>Request</th><th>Style / Factory</th><th>Status</th><th>Assigned factory user</th><th>Action</th></tr></thead>
          <tbody>
            {visibleRequests.map((request) => {
              const product = Array.isArray(request.nextgen_products) ? request.nextgen_products[0] : request.nextgen_products;
              const current = assignments[request.id] ?? "";
              return (
                <tr key={request.id}>
                  <td><strong>{request.request_number ?? request.id.slice(0, 8)}</strong></td>
                  <td><strong>{product?.style_number ?? "Pending style"}</strong><span className="eyebrow">{request.factory_name ?? "Unassigned factory"}</span></td>
                  <td><span className="status blue">{statusLabels[request.status as CostingStatus] ?? request.status.replace(/_/g, " ")}</span></td>
                  <td>
                    <select className="input" value={current} onChange={(event) => setAssignments((previous) => ({ ...previous, [request.id]: event.target.value }))} disabled={!users.length}>
                      <option value="">Unassigned</option>
                      {users.map((user) => <option key={user.id} value={user.id}>{user.display_name}{user.email ? ` · ${user.email}` : ""}</option>)}
                    </select>
                  </td>
                  <td><button className="button secondary small-btn" type="button" onClick={() => save(request.id)} disabled={busyId !== null || !users.length}>{busyId === request.id ? "Saving..." : "Save"}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!visibleRequests.length ? <div className="empty-state compact-empty"><strong>No matching active requests</strong></div> : null}
      {message ? <p className="form-message saved">{message}</p> : null}
    </div>
  );
}
