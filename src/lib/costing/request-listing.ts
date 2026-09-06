import { tryListCostingRequests } from "@/lib/costing/requests";
import { resolveFactoryProfileId } from "@/lib/admin/assignments";

// One owner for the request-list page size: the dashboard and the All Requests
// page paginate identically.
export const REQUEST_PAGE_SIZE = 5;

/**
 * Resolves the caller's factory profile when the role is factory (used to
 * scope every request list to the caller's own assignments). Non-factory
 * roles get null — they see every request their role is allowed to see.
 */
export async function resolveFactoryScope(
  role: string,
  userId: string
): Promise<{ factoryProfileId: string | null }> {
  if (role !== "factory") return { factoryProfileId: null };
  const factoryProfileId = await resolveFactoryProfileId(userId).catch(() => null);
  return { factoryProfileId };
}

/**
 * Factory users only see requests assigned to them. Draft is always filtered
 * out for unassigned factory users; sent_to_factory and needs_clarification
 * are restricted to the caller's assignment so factories cannot reach other
 * factories' queues. Non-factory rows pass through untouched.
 */
export function scopeRowsForRole<T extends { assigned_factory_user_id?: string | null }>(
  rows: T[],
  role: string,
  factoryProfileId: string | null
): T[] {
  return role === "factory"
    ? rows.filter((row) => Boolean(factoryProfileId && row.assigned_factory_user_id === factoryProfileId))
    : rows;
}

/**
 * Fetches one page of requests scoped to the caller's role. Factory users get
 * their assigned subset (fetched up to the cap and paginated in JS); every
 * other role gets a normal paged query filtered to their visible statuses.
 * `overdue` is translated to "all" statuses so the overdue filter can be
 * applied on top in the caller (the aging data drives which rows are overdue).
 */
export async function listScopedRequestPage(input: {
  role: string;
  userId: string;
  query?: string;
  status?: string;
  brand?: string;
  customer?: string;
  season?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}) {
  const { factoryProfileId } = await resolveFactoryScope(input.role, input.userId);
  const listed = await tryListCostingRequests({
    query: input.query,
    status: input.status === "overdue" ? "all" : input.status,
    brand: input.brand || undefined,
    customer: input.customer || undefined,
    season: input.season || undefined,
    from: input.from || undefined,
    to: input.to || undefined,
    limit: input.role === "factory" ? 1000 : input.limit ?? REQUEST_PAGE_SIZE,
    offset: input.role === "factory" ? 0 : input.offset ?? 0,
    roles: [input.role],
    sortBy: input.sortBy,
    sortDir: input.sortDir
  });
  const scoped = scopeRowsForRole(listed.data ?? [], input.role, factoryProfileId);
  return {
    rows: scoped,
    total: input.role === "factory" ? scoped.length : listed.total,
    error: listed.error,
    factoryProfileId
  };
}