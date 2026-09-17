import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { fetchNextGenPricingSnapshot, nextGenPricingFromRaw } from "@/lib/costing/nextgen-pricing";
import { pgrestLike, pgrestOrTerms, pgrestValue } from "@/lib/supabase/filters";
import { phaseOneStatuses, type CostingStatus } from "@/lib/workflow/status";

export type CreateCostingRequestInput = {
  nextgenEntityId?: string;
  styleNumber: string;
  productName?: string;
  factoryName?: string;
  season?: string;
  brand?: string;
  customer?: string;
  poNumber?: string;
  mpoNumber?: string;
  productCategory?: string;
  buyerStyleNumber?: string;
  notes?: string;
  nextgenRaw?: unknown;
  forceCreate?: boolean;
  bomLines?: CreateBomLineInput[];
  /** Snapshot of the comparable approved costing copied in via Like Styles. */
  baselineRef?: import("./history").BaselineRef | null;
};

export type CreateBomLineInput = {
  id?: string;
  category?: string;
  materialName?: string;
  materialDescription?: string;
  materialType?: string;
  supplierName?: string;
  placement?: string;
  quotePrice?: string | number;
  quoteCurrency?: string;
  complianceStatus?: string;
  colorway?: string;
  usage?: string | number;
  size?: string;
  headerVersion?: string;
  bomVersionComment?: string;
  raw?: unknown;
};

export type CostingRequestDetail = {
  id: string;
  request_number: string | null;
  factory_name: string | null;
  assigned_factory_user_id: string | null;
  status: string;
  priority: string;
  customer_status: string;
  customer_status_updated_at: string | null;
  customer_submitted_at?: string | null;
  customer_decision_at?: string | null;
  customer_revision_due_at?: string | null;
  customer_revision_number?: number;
  customer_notes?: string | null;
  pbd_pricing?: Record<string, unknown> | null;
  pbd_pricing_status?: string | null;
  pbd_pricing_updated_at?: string | null;
  cost_sheet_ready?: boolean;
  cost_sheet_ready_at?: string | null;
  cost_sheet_ready_by?: string | null;
  bom_version?: string | null;
  bom_version_comment?: string | null;
  created_at: string;
  updated_at: string;
  season?: string | null;
  brand?: string | null;
  customer?: string | null;
  po_number?: string | null;
  mpo_number?: string | null;
  product_category?: string | null;
  buyer_style_number?: string | null;
  notes?: string | null;
  baseline_ref?: import("./history").BaselineRef | null;
  nextgen_products:
    | {
        id: string;
        nextgen_entity_id: string;
        style_number: string | null;
        name: string | null;
        bom_version?: string | null;
        bom_version_comment?: string | null;
        metadata_checked_at?: string | null;
        raw_payload: unknown;
        nextgen_bom_lines: {
          id: string;
          nextgen_line_id: string | null;
          material_code: string | null;
          material_name: string | null;
          material_description?: string | null;
          material_type?: string | null;
          category: string | null;
          consumption: number | null;
          uom: string | null;
          supplier_name?: string | null;
          placement?: string | null;
          quote_price?: number | null;
          quote_currency?: string | null;
          compliance_status?: string | null;
          colorway?: string | null;
          raw_payload: unknown;
        }[];
      }
    | {
        id: string;
        nextgen_entity_id: string;
        style_number: string | null;
        name: string | null;
        bom_version?: string | null;
        bom_version_comment?: string | null;
        metadata_checked_at?: string | null;
        raw_payload: unknown;
        nextgen_bom_lines: {
          id: string;
          nextgen_line_id: string | null;
          material_code: string | null;
          material_name: string | null;
          material_description?: string | null;
          material_type?: string | null;
          category: string | null;
          consumption: number | null;
          uom: string | null;
          supplier_name?: string | null;
          placement?: string | null;
          quote_price?: number | null;
          quote_currency?: string | null;
          compliance_status?: string | null;
          colorway?: string | null;
          raw_payload: unknown;
        }[];
      }[]
    | null;
  validation_results: {
    id: string;
    severity: string;
    rule_code: string;
    message: string;
    field_path: string | null;
    created_at: string;
  }[];
  approval_actions: {
    id: string;
    action: string;
    actor_role: string | null;
    from_status: string | null;
    to_status: string | null;
    comment: string | null;
    metadata: unknown;
    created_at: string;
  }[];
  factory_cbds: {
    id: string;
    status: string;
    submitted_by: string | null;
    submitted_at: string | null;
    raw_payload: unknown;
    cbd_material_lines: {
      id: string;
      bom_line_id: string | null;
      material_name: string | null;
      consumption: number | null;
      uom: string | null;
      unit_cost: number | null;
      total_cost: number | null;
      currency: string | null;
    }[];
  }[];
};

export async function listCostingRequests(input?: { query?: string; status?: string; brand?: string; customer?: string; season?: string; from?: string; to?: string; limit?: number; offset?: number; roles?: string[]; sortBy?: string; sortDir?: "asc" | "desc" }) {
  const supabase = createSupabaseServiceClient();
  // Clamp pagination so hostile numeric params (1e18, -1, NaN) can never
  // reach PostgREST's range() as an invalid or unbounded window.
  const pageSize = Math.min(Math.max(Number.isFinite(input?.limit) ? (input?.limit ?? 5) : 5, 1), 5000);
  const offset = Math.min(Math.max(Number.isFinite(input?.offset) ? (input?.offset ?? 0) : 0, 0), 1000000);
  const sortBy = input?.sortBy ?? "created_at";
  const sortDir = input?.sortDir ?? "desc";

  let request = supabase
    .from("costing_requests")
    .select(
      `
      id,
      request_number,
      factory_name,
      assigned_factory_user_id,
      status,
      priority,
      customer_status,
      customer_status_updated_at,
      customer_submitted_at,
      customer_decision_at,
      customer_revision_due_at,
      customer_revision_number,
      customer_notes,
      cost_sheet_ready,
      cost_sheet_ready_at,
      cost_sheet_ready_by,
      season,
      brand,
      customer,
      created_at,
      updated_at,
      nextgen_products (
        style_number,
        name
      )
    `,
      { count: "exact" }
    )
    .order(sortBy, { ascending: sortDir === "asc" })
    .range(offset, offset + pageSize - 1);

  // User-supplied status is validated against the canonical workflow statuses
  // (src/lib/workflow/status.ts — the single owner of the status vocabulary)
  // before it reaches PostgREST. An arbitrary value (e.g. one containing
  // spaces or operators like "x OR 1=1") would otherwise be parsed as part of
  // the filter grammar and can hang or error the request — treat it as "no
  // status filter" instead.
  const knownStatus = input?.status && phaseOneStatuses.includes(input.status as CostingStatus) ? input.status : null;
  if (knownStatus && knownStatus !== "all") {
    request = request.eq("status", knownStatus);
  }
  if (input?.brand?.trim()) {
    request = request.ilike("brand", pgrestLike(input.brand.trim()));
  }
  if (input?.customer?.trim()) {
    request = request.ilike("customer", pgrestLike(input.customer.trim()));
  }
  if (input?.season?.trim()) {
    request = request.ilike("season", pgrestLike(input.season.trim()));
  }
  if (input?.from?.trim()) {
    request = request.gte("created_at", pgrestValue(input.from.trim()));
  }
  if (input?.to?.trim()) {
    // inclusive to end of day
    const toDate = new Date(input.to.trim());
    if (!Number.isNaN(toDate.getTime())) {
      toDate.setDate(toDate.getDate() + 1);
      request = request.lt("created_at", pgrestValue(toDate.toISOString().slice(0, 10)));
    }
  }

  // Role-based visibility: filter by status depending on which roles can see them
  if (input?.roles && input.roles.length > 0) {
    const allowedStatuses = getStatusesForRoles(input.roles);
    if (allowedStatuses.length > 0) {
      request = request.in("status", allowedStatuses);
    }
  }

  const query = input?.query?.trim();

  if (query) {
    // PostgREST parses commas inside unquoted `.or()` filter values as branch
    // separators (PGRST100 → 500), so or-terms are built through the shared
    // helper which quotes the value — verified live: quoted or() values are
    // stripped by the grammar and match correctly on this server.
    request = request.or(pgrestOrTerms(["request_number", "factory_name"], query));
  }

  const { data, error, count } = await request;

  if (error) {
    // PostgREST answers 416 / PGRST103 when the requested range starts beyond
    // the available rows (deep pagination past the end, or a hostile offset).
    // That is an empty page, not an error — the client asked for rows that do
    // not exist yet.
    if ((error as { code?: string }).code === "PGRST103") {
      return { data: [], total: count ?? 0 };
    }
    throw error;
  }

  return { data: data ?? [], total: count ?? 0 };
}

// Map roles to the statuses they are allowed to see. The status vocabulary
// is owned by src/lib/workflow/status.ts (phaseOneStatuses — the full
// workflow set; migration 014 moved any legacy `pending_manager_approval`
// rows to `for_pbd_review`). This function only derives role visibility from
// that canonical set.
export function getStatusesForRoles(roles: string[]): string[] {
  const allStatuses = phaseOneStatuses;

  // Super Admin and Admin see everything
  if (roles.includes("superadmin") || roles.includes("admin")) {
    return [...allStatuses];
  }

  // Viewer sees everything (read-only)
  if (roles.includes("viewer")) {
    return [...allStatuses];
  }

  const statuses = new Set<string>();

  // PBD sees: draft (they create), sent_to_factory (they sent it), for_md_review / for_costing_review (track progress),
  // for_pbd_review (Costing has validated), needs_clarification, approved, rejected
  if (roles.includes("pbd")) {
    statuses.add("draft");
    statuses.add("sent_to_factory");
    statuses.add("for_md_review");
    statuses.add("for_costing_review");
    statuses.add("for_pbd_review");
    statuses.add("needs_clarification");
    statuses.add("approved");
    statuses.add("rejected");
  }

  // Costing Team sees: for_md_review (waiting on MD before their queue), for_costing_review (their queue),
  // needs_clarification, approved, rejected; also for_pbd_review (read-only, to track what they've passed on)
  if (roles.includes("costing")) {
    statuses.add("for_md_review");
    statuses.add("for_costing_review");
    statuses.add("for_pbd_review");
    statuses.add("needs_clarification");
    statuses.add("approved");
    statuses.add("rejected");
  }

  // Factory sees ONLY requests that are theirs to act on: drafts assigned to
  // them, sent_to_factory, and needs_clarification (CBD returned to them).
  // Requests in the Madison88 internal review stages (MD/Costing/PBD) and the
  // terminal "internally approved" outcome are invisible to the factory — the
  // internal team owns the request from review until decision.
  if (roles.includes("factory")) {
    statuses.add("draft");
    statuses.add("sent_to_factory");
    statuses.add("needs_clarification");
    statuses.add("rejected");
  }

  // MD reviews run right after factory CBD submission, before costing validation.
  if (roles.includes("md")) {
    statuses.add("for_md_review");
    statuses.add("for_costing_review");
    statuses.add("for_pbd_review");
    statuses.add("needs_clarification");
  }

  return Array.from(statuses);
}

export async function tryListCostingRequests(input?: { query?: string; status?: string; brand?: string; customer?: string; season?: string; from?: string; to?: string; limit?: number; offset?: number; roles?: string[]; sortBy?: string; sortDir?: "asc" | "desc" }) {
  try {
    const result = await listCostingRequests(input);
    return {
      data: result.data,
      total: result.total,
      error: null
    };
  } catch (error) {
    return {
      data: null,
      total: 0,
      error: error instanceof Error ? error.message : "Unable to list requests"
    };
  }
}

/** Column added by migration 009; only safe to select once it is applied. */
const METADATA_CHECKED_AT_COLUMN = "metadata_checked_at";

function requestDetailSelect(includeMetadataCheckedAt: boolean) {
  return `
      id,
      request_number,
      factory_name,
      assigned_factory_user_id,
      status,
      priority,
      customer_status,
      customer_status_updated_at,
      customer_submitted_at,
      customer_decision_at,
      customer_revision_due_at,
      customer_revision_number,
      customer_notes,
      cost_sheet_ready,
      cost_sheet_ready_at,
      cost_sheet_ready_by,
      season,
      brand,
      customer,
      po_number,
      mpo_number,
      product_category,
      buyer_style_number,
      notes,
      baseline_ref,
      pbd_pricing,
      pbd_pricing_status,
      pbd_pricing_updated_at,
      pbd_pricing_updated_by,
      created_at,
      updated_at,
      nextgen_products (
        id,
        nextgen_entity_id,
        style_number,
        name,
        bom_version,
        bom_version_comment,
        ${includeMetadataCheckedAt ? METADATA_CHECKED_AT_COLUMN + "," : ""}
        raw_payload,
        nextgen_bom_lines (
          id,
          nextgen_line_id,
          material_code,
          material_name,
          material_description,
          material_type,
          category,
          consumption,
          uom,
          supplier_name,
          placement,
          quote_price,
          quote_currency,
          compliance_status,
          colorway,
          raw_payload
        )
      ),
      validation_results (
        id,
        severity,
        rule_code,
        message,
        field_path,
        created_at
      ),
      approval_actions (
        id,
        action,
        actor_role,
        from_status,
        to_status,
        comment,
        metadata,
        created_at
      ),
      factory_cbds (
        id,
        status,
        submitted_by,
        submitted_at,
        raw_payload,
        cbd_material_lines (
          id,
          bom_line_id,
          material_name,
          consumption,
          uom,
          unit_cost,
          total_cost,
          currency
        )
      )
    `;
}

export async function getCostingRequest(id: string) {
  const supabase = createSupabaseServiceClient();

  // Try with the metadata_checked_at column first. When migration 009 has not
  // been applied to this database yet, PostgREST rejects the select with
  // "column ... does not exist" — degrade to the pre-009 shape so the request
  // detail page keeps working (the panel falls back to "hourly refresh
  // pending"). Never surface the migration gap as a broken page.
  const attempt = await supabase
    .from("costing_requests")
    .select(requestDetailSelect(true))
    .eq("id", id)
    .single();

  if (!attempt.error && attempt.data) return attempt.data as unknown as CostingRequestDetail;

  const message = attempt.error.message ?? "";
  if (!message.includes(METADATA_CHECKED_AT_COLUMN)) throw attempt.error;

  const fallback = await supabase
    .from("costing_requests")
    .select(requestDetailSelect(false))
    .eq("id", id)
    .single();
  if (fallback.error) throw fallback.error;
  if (!fallback.data) throw new Error("Request not found");

  return fallback.data as unknown as CostingRequestDetail;
}

export async function tryGetCostingRequest(id: string) {
  try {
    return {
      data: await getCostingRequest(id),
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to load request"
    };
  }
}

export async function createCostingRequest(input: CreateCostingRequestInput) {
  const supabase = createSupabaseServiceClient();

  // Snapshot the NextGen BOM version (HeaderVersionNumber / BomVersionComment)
  // captured at creation so later checks can detect upstream BOM changes.
  const bomVersion = input.bomLines?.map((line) => line.headerVersion).find(Boolean) ?? null;
  const bomVersionComment = input.bomLines?.map((line) => line.bomVersionComment).find(Boolean) ?? null;

  const productPayload = {
    nextgen_entity_id: input.nextgenEntityId ?? `manual:${input.styleNumber}`,
    style_number: input.styleNumber,
    name: input.productName ?? input.styleNumber,
    product_category: input.productCategory?.trim() || null,
    buyer_style_number: input.buyerStyleNumber?.trim() || null,
    bom_version: bomVersion,
    bom_version_comment: bomVersionComment,
    raw_payload:
      input.nextgenRaw && typeof input.nextgenRaw === "object"
        ? input.nextgenRaw
        : {
            source: input.nextgenEntityId ? "nextgen" : "manual",
            notes: input.notes ?? null
          }
  };

  // Best-effort ERP pricing backfill: API-created requests often carry only
  // the entity id, which leaves no selling/purchase price for the approval
  // gate and margin math. Pull the pricing keys straight from NextGen and
  // merge them under any caller-provided values. Never blocks creation.
  if (input.nextgenEntityId && nextGenPricingFromRaw(productPayload.raw_payload).sellingPrice === null) {
    const pricing = await fetchNextGenPricingSnapshot(input.nextgenEntityId);
    if (pricing) {
      productPayload.raw_payload = {
        ...pricing,
        ...(productPayload.raw_payload as Record<string, unknown>)
      };
    }
  }

  const { data: product, error: productError } = await supabase
    .from("nextgen_products")
    .upsert(productPayload, { onConflict: "nextgen_entity_id" })
    .select("id")
    .single();

  if (productError) throw productError;

  if (input.factoryName?.trim()) {
    const { data: existing, error: existingError } = await supabase
      .from("costing_requests")
      .select("id, request_number, status")
      .eq("product_id", product.id)
      .eq("factory_name", input.factoryName.trim())
      .not("status", "in", "(approved,rejected)")
      .limit(1);

    if (existingError) throw existingError;

    if (existing?.length && !input.forceCreate) {
      throw new Error(
        `Duplicate active request exists for this style/factory: ${existing[0].request_number ?? existing[0].id}`
      );
    }
  }

  if (input.bomLines?.length) {
    const { error: deleteBomError } = await supabase
      .from("nextgen_bom_lines")
      .delete()
      .eq("product_id", product.id);

    if (deleteBomError) throw deleteBomError;

    const linePayload = input.bomLines.map((line) => ({
      product_id: product.id,
      nextgen_line_id: line.id ?? null,
      material_code: null,
      material_name: line.materialName ?? line.materialDescription ?? "Unnamed material",
      material_description: line.materialDescription ?? null,
      material_type: line.materialType ?? null,
      category: line.category ?? line.materialType ?? null,
      consumption: typeof line.usage === "number" ? line.usage : parseNumber(line.usage),
      uom: line.size ?? null,
      supplier_name: line.supplierName ?? null,
      placement: line.placement ?? null,
      quote_price: line.quotePrice != null ? parseNumber(line.quotePrice) : null,
      quote_currency: line.quoteCurrency ?? null,
      compliance_status: line.complianceStatus ?? null,
      colorway: line.colorway ?? null,
      raw_payload: line.raw && typeof line.raw === "object" ? line.raw : line
    }));

    const { error: bomError } = await supabase.from("nextgen_bom_lines").insert(linePayload);

    if (bomError) throw bomError;
  }

  const requestNumber = `CR-${Date.now().toString().slice(-6)}`;

  const { data: request, error: requestError } = await supabase
    .from("costing_requests")
    .insert({
      product_id: product.id,
      request_number: requestNumber,
      factory_name: input.factoryName ?? null,
      season: input.season?.trim() || null,
      brand: input.brand?.trim() || null,
      customer: input.customer?.trim() || null,
      po_number: input.poNumber?.trim() || null,
      mpo_number: input.mpoNumber?.trim() || null,
      product_category: input.productCategory?.trim() || null,
      buyer_style_number: input.buyerStyleNumber?.trim() || null,
      notes: input.notes?.trim() || null,
      baseline_ref: input.baselineRef ?? null,
      status: "draft",
      priority: "normal"
    })
    .select()
    .single();

  if (requestError) throw requestError;

  return request;
}

function parseNumber(value: unknown) {
  if (typeof value !== "string") return null;

  const parsed = Number(value.replace(/,/g, ""));

  return Number.isFinite(parsed) ? parsed : null;
}
