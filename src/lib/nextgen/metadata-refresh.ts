import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { legacyKendoSearchPayload, nextGenPost } from "./client";
import { normalizeProductSearch } from "./normalize";
import { nextGenMetaFromRaw, nextGenMetaOf, type NextGenMeta } from "./product-meta";
import { recordWorkflowEvent } from "@/lib/workflow/events";
import { enqueueCostingChangeAlert } from "@/lib/notifications/workflow-alerts";

/**
 * NextGen product metadata refresh.
 *
 * The request-detail "NextGen Product Data" panel used to show metadata
 * "captured at request creation" forever. This re-fetches the live NextGen
 * product row for every style linked to an active request, diffs the fields
 * the panel displays (lifecycle status, composition, SMV / GSD / allowed /
 * factory time), alerts the costing team through the change-alert flow when
 * something actually changed, and stamps metadata_checked_at so the UI can
 * show "Last refreshed" with a real timestamp.
 *
 * BOM version changes are deliberately NOT alerted here — checkBomVersions
 * owns that; this refresh only updates the raw snapshot fields it shares.
 */

export type MetadataRefreshResult = {
  /** Unique styles (NextGen products) re-fetched from NextGen. */
  checked: number;
  /** Styles whose status/composition/labor metadata changed. */
  changed: number;
  /** Active requests alerted because their style's metadata changed. */
  alertedRequests: number;
  /** Last-checked timestamp written; null when migration 009 is pending. */
  updatedAt: string | null;
  errors: string[];
};

/** Stable fingerprint of the panel-displayed metadata fields. */
export function metadataFingerprint(meta: NextGenMeta): string {
  return [
    meta.status,
    meta.composition,
    meta.smv,
    meta.gsdSmv,
    meta.allowedTime,
    meta.factoryTime
  ]
    .map((value) => value ?? "")
    .join("|");
}

type ActiveProductRow = {
  id: string;
  nextgen_entity_id: string;
  style_number: string | null;
  raw_payload: unknown;
};

type ActiveRequestRow = {
  id: string;
  request_number: string | null;
  factory_name: string | null;
  product_id: string | null;
};

/**
 * Re-fetch NextGen metadata for every style linked to an active request.
 * Returns a summary; never throws.
 */
export async function refreshActiveProductMetadata(limit = 300): Promise<MetadataRefreshResult> {
  const result: MetadataRefreshResult = { checked: 0, changed: 0, alertedRequests: 0, updatedAt: null, errors: [] };
  const supabase = createSupabaseServiceClient();

  try {
    const { data: requests, error: requestError } = await supabase
      .from("costing_requests")
      .select("id, request_number, factory_name, product_id")
      .not("status", "in", "(approved,rejected)")
      .limit(1000);
    if (requestError) {
      result.errors.push(`requests: ${requestError.message}`);
      return result;
    }

    const requestRows = (requests ?? []) as ActiveRequestRow[];
    const productIds = [...new Set(requestRows.map((r) => r.product_id).filter((id): id is string => Boolean(id)))];
    if (productIds.length === 0) return result;

    const { data: products, error: productError } = await supabase
      .from("nextgen_products")
      .select("id, nextgen_entity_id, style_number, raw_payload")
      .in("id", productIds)
      .limit(1000);
    if (productError) {
      result.errors.push(`products: ${productError.message}`);
      return result;
    }

    const styles: ActiveProductRow[] = ((products ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      nextgen_entity_id: String(row.nextgen_entity_id ?? ""),
      style_number: (row.style_number as string | null) ?? null,
      raw_payload: row.raw_payload
    }));
    const requestsByProduct = new Map<string, ActiveRequestRow[]>();
    for (const row of requestRows) {
      if (!row.product_id) continue;
      const list = requestsByProduct.get(row.product_id) ?? [];
      list.push(row);
      requestsByProduct.set(row.product_id, list);
    }

    const now = new Date().toISOString();
    const batchSize = 5;
    for (let i = 0; i < styles.length; i += batchSize) {
      const batch = styles.slice(i, i + batchSize);
      const searchResults = await Promise.allSettled(
        batch.map((style) =>
          nextGenPost("productSearch", legacyKendoSearchPayload(style.style_number ?? style.nextgen_entity_id, "Name"))
        )
      );

      for (let j = 0; j < batch.length; j++) {
        const style = batch[j];
        const settled = searchResults[j];
        result.checked++;

        if (settled.status === "rejected" || !settled.value.ok) {
          result.errors.push(`${style.style_number ?? style.nextgen_entity_id}: metadata fetch failed`);
          continue;
        }

        const products = normalizeProductSearch(settled.value.body);
        const match =
          products.find(
            (product) =>
              product.entityId === style.nextgen_entity_id ||
              (style.style_number && product.styleNumber === style.style_number)
          ) ?? products[0];
        if (!match) {
          result.errors.push(`${style.style_number ?? style.nextgen_entity_id}: no product row returned`);
          continue;
        }

        const liveMeta = nextGenMetaOf({
          entityId: match.entityId,
          styleNumber: match.styleNumber,
          name: match.name,
          status: match.status,
          externalReference: match.externalReference,
          composition: match.composition,
          smv: match.smv,
          gsdSmv: match.gsdSmv,
          allowedTime: match.allowedTime,
          factoryTime: match.factoryTime,
          raw: match.raw
        });
        const storedMeta = nextGenMetaFromRaw(style.raw_payload);

        if (metadataFingerprint(liveMeta) !== metadataFingerprint(storedMeta)) {
          result.changed++;
          const affectedRequests = requestsByProduct.get(style.id) ?? [];
          for (const req of affectedRequests) {
            await enqueueCostingChangeAlert({
              requestId: req.id,
              requestNumber: req.request_number,
              factoryName: req.factory_name,
              subject: `[${req.request_number ?? "Request"}] NextGen product data updated`,
              body: [
                `Request: ${req.request_number ?? "Unknown"}`,
                `Factory: ${req.factory_name ?? "Unassigned"}`,
                `Style: ${style.style_number ?? match.styleNumber}`,
                ``,
                `Changed: ${describeMetadataChange(storedMeta, liveMeta)}`,
                ``,
                `The NextGen product row for this style was updated. Please re-validate the request against the new data.`
              ].join("\n"),
              kind: "bom_changed"
            });
            await recordWorkflowEvent(supabase, {
              costingRequestId: req.id,
              eventType: "nextgen_metadata_changed",
              actorRole: "system",
              payload: {
                source: "nextgen_metadata_refresh",
                styleNumber: style.style_number,
                before: storedMeta,
                after: liveMeta
              }
            }).catch(() => {
              // Best-effort — never block the alert on event-recording failures.
            });
            result.alertedRequests++;
          }
        }

        await updateCheckedAt(supabase, style.id, match.raw, now, result);
      }
  
    }

    return result;
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : "refreshActiveProductMetadata failed");
    return result;
  }
}

/** Updates the stored product row with the fresh NextGen payload + checked-at stamp. */
async function updateCheckedAt(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  productId: string,
  rawPayload: unknown,
  now: string,
  result: MetadataRefreshResult
) {
  const attempt = await supabase
    .from("nextgen_products")
    .update({ raw_payload: rawPayload, metadata_checked_at: now })
    .eq("id", productId);

  if (attempt.error && /metadata_checked_at|schema cache|does not exist/i.test(attempt.error.message)) {
    // Migration 009 pending — degrade to updating the snapshot without the stamp.
    const fallback = await supabase
      .from("nextgen_products")
      .update({ raw_payload: rawPayload })
      .eq("id", productId);
    if (fallback.error) result.errors.push(`snapshot update: ${fallback.error.message}`);
    return;
  }
  if (attempt.error) {
    result.errors.push(`snapshot update: ${attempt.error.message}`);
    return;
  }
  result.updatedAt = now;
}

/** Human-readable before → after for the alert body. */
function describeMetadataChange(before: NextGenMeta, after: NextGenMeta): string {
  const rows: Array<[string, string, string]> = [
    ["Status", before.status ?? "—", after.status ?? "—"],
    ["Composition", before.composition ?? "—", after.composition ?? "—"],
    ["SMV", before.smv ?? "—", after.smv ?? "—"],
    ["GSD SMV", before.gsdSmv ?? "—", after.gsdSmv ?? "—"],
    ["Allowed time", before.allowedTime ?? "—", after.allowedTime ?? "—"],
    ["Factory time", before.factoryTime ?? "—", after.factoryTime ?? "—"]
  ];
  const parts: string[] = [];
  for (const [label, prev, next] of rows) {
    if (prev !== next) parts.push(`${label}: ${prev} → ${next}`);
  }
  return parts.length ? parts.join(" · ") : "metadata";
}
