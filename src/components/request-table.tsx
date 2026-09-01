import Link from "next/link";
import type { CostingRequestSummary } from "@/lib/workflow/mock-data";
import { maskStatusForRole, type CostingStatus } from "@/lib/workflow/status";
import { StatusPill } from "./status-pill";
import { SelectAllCheckbox } from "./select-all-checkbox";
import { IconArrowRight } from "@/components/ui/icons";
import { Avatar } from "./ui/avatar";

type SortField = "request_number" | "factory_name" | "status" | "created_at";
type SortDir = "asc" | "desc";

interface SortableHeaderProps {
  field: SortField;
  label: string;
  currentSortBy: string;
  currentSortDir: SortDir;
  basePath: string;
  queryParams: Record<string, string | undefined>;
}

function SortableHeader({ field, label, currentSortBy, currentSortDir, basePath, queryParams }: SortableHeaderProps) {
  const isActive = currentSortBy === field;
  const nextDir: SortDir = isActive && currentSortDir === "desc" ? "asc" : "desc";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  params.set("sortBy", field);
  params.set("sortDir", nextDir);
  const arrow = isActive ? (currentSortDir === "asc" ? " \u2191" : " \u2193") : "";
  return (
    <th>
      <Link href={`${basePath}?${params.toString()}`} className="sort-header">
        {label}
        <span className={`sort-arrow ${isActive ? "sort-active" : ""}`}>{arrow.trim() || "\u2195"}</span>
      </Link>
    </th>
  );
}

type DatabaseRequest = {
  id: string;
  request_number: string | null;
  factory_name: string | null;
  status: CostingRequestSummary["status"];
  created_at: string;
  customer_status?: string | null;
  nextgen_products:
    | {
        style_number: string | null;
        name: string | null;
      }
    | {
        style_number: string | null;
        name: string | null;
      }[]
    | null;
};

function getProduct(row: DatabaseRequest) {
  return Array.isArray(row.nextgen_products) ? row.nextgen_products[0] : row.nextgen_products;
}

function mapDatabaseRequest(row: DatabaseRequest): CostingRequestSummary {
  const product = getProduct(row);
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  const ageDays = Math.max(0, Math.floor(ageMs / 86_400_000));

  return {
    id: row.id,
    requestNumber: row.request_number ?? row.id,
    styleNumber: product?.style_number ?? "No style",
    productName: product?.name ?? "Pending product details",
    factoryName: row.factory_name ?? "Unassigned",
    status: row.status,
    ageDays,
    totalCost: "Pending",
    variance: "Pending",
    owner: row.status === "needs_clarification" ? "Factory" : row.status === "approved" ? "Done" : "PBD"
  };
}

export function RequestTable({
  rows,
  sortBy = "created_at",
  sortDir = "desc",
  queryParams = {},
  role = "viewer",
  overdueIds = new Set<string>(),
  unreadCounts = {}
}: {
  rows?: DatabaseRequest[] | null;
  sortBy?: string;
  sortDir?: SortDir;
  queryParams?: Record<string, string | undefined>;
  role?: string;
  overdueIds?: Set<string>;
  /** Unread in-app change alert counts per request id (dashboard badges). */
  unreadCounts?: Record<string, number>;
}) {
  const isLive = Array.isArray(rows);
  const requests = rows?.map(mapDatabaseRequest) ?? [];

  return (
    <>
      {isLive && !requests.length ? (
        <div className="empty-state">
          <strong>No costing requests found</strong>
          <p>Create a new request from NextGen, or clear the dashboard filters.</p>
        </div>
      ) : null}
      {!isLive ? (
        <div className="empty-state">
          <strong>Costing data is temporarily unavailable</strong>
          <p>No sample records are displayed in production. Retry after the database connection is restored.</p>
        </div>
      ) : null}
      {requests.length ? (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                {isLive ? <th className="col-check"><SelectAllCheckbox /></th> : null}
                <SortableHeader field="request_number" label="Request" currentSortBy={sortBy} currentSortDir={sortDir} basePath="/" queryParams={queryParams} />
                <th>Style</th>
                <SortableHeader field="factory_name" label="Factory" currentSortBy={sortBy} currentSortDir={sortDir} basePath="/" queryParams={queryParams} />
                <SortableHeader field="status" label="Status" currentSortBy={sortBy} currentSortDir={sortDir} basePath="/" queryParams={queryParams} />
                <SortableHeader field="created_at" label="Age" currentSortBy={sortBy} currentSortDir={sortDir} basePath="/" queryParams={queryParams} />
                <th>Customer</th>
                <th className="col-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const rowStatus = request.status;
                const isOverdue = overdueIds.has(request.id);
                const ageClass = isOverdue ? "red" : request.ageDays >= 3 && rowStatus !== "approved" ? "amber" : "neutral";
                const customerStatus = isLive ? formatCustomerStatus(rows.find((row) => row.id === request.id)?.customer_status) : "Pending";

                return (
                  <tr key={request.id} className={`row-${rowStatus}`}>
                    {isLive ? (
                      <td className="col-check">
                        <input
                          type="checkbox"
                          name="selectedIds"
                          value={request.id}
                          disabled={rowStatus !== "for_pbd_review" && rowStatus !== "for_costing_review" && rowStatus !== "draft" && rowStatus !== "approved"}
                        />
                      </td>
                    ) : null}
                    <td>
                      <Link href={`/requests/${request.id}`} className="req-link">
                        <strong>{request.requestNumber}</strong>
                      </Link>
                      {unreadCounts[request.id] ? (
                        <span
                          className="inapp-badge"
                          title={`${unreadCounts[request.id]} unread change alert${unreadCounts[request.id] > 1 ? "s" : ""}`}
                        >
                          {unreadCounts[request.id]}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <div className="style-cell">
                        <strong>{request.styleNumber}</strong>
                        <span className="eyebrow">{request.productName}</span>
                      </div>
                    </td>
                    <td>
                      <div className="cell-with-avatar">
                        <Avatar name={request.factoryName} size="sm" />
                        <span>{request.factoryName}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill status={maskStatusForRole(rowStatus, role)} />
                    </td>
                    <td>
                      <span className={`age-badge age-${ageClass}`} title={isOverdue ? "SLA overdue" : undefined}>
                        {request.ageDays}d
                      </span>
                      {isOverdue ? <small className="overdue-label">Overdue</small> : null}
                    </td>
                    <td>
                      <span className={`customer-badge customer-${(customerStatus ?? "").toLowerCase().replace(/\s+/g, "-")}`}>
                        {customerStatus}
                      </span>
                    </td>
                    <td className="col-action">
                      <Link href={quickActionHref(request, role)} className="table-action primary-action" aria-label={`${quickActionLabel(request, role)} ${request.requestNumber}`}>
                        {quickActionLabel(request, role)} <IconArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function quickActionLabel(request: CostingRequestSummary, role: string) {
  if (role === "factory" && ["sent_to_factory", "needs_clarification", "draft"].includes(request.status)) return "Open CBD";
  if (role === "costing" && request.status === "for_costing_review") return "Validate";
  if (role === "md" && request.status === "for_md_review") return "MD Review";
  if ((role === "pbd" || role === "manager" || role === "admin") && request.status === "for_pbd_review") return "Review";
  if (role === "manager" && request.status === "pending_manager_approval") return "Approve";
  return "Open";
}

function quickActionHref(request: CostingRequestSummary, role: string) {
  const factoryQueue = (["sent_to_factory", "needs_clarification", "draft"] as string[]).includes(request.status);
  return role === "factory" && factoryQueue
    ? `/factory/${request.id}`
    : `/requests/${request.id}`;
}

function formatCustomerStatus(status?: string | null) {
  if (!status || status === "not_submitted") return "Not submitted";

  const labels: Record<string, string> = {
    pending_customer_submission: "Ready for customer",
    sent_to_customer: "Sent to customer",
    under_negotiation: "Under negotiation",
    customer_approved: "Customer approved",
    customer_rejected_revised: "Revision required",
    closed: "Closed"
  };
  if (labels[status]) return labels[status];

  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
