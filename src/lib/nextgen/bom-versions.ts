import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { recordWorkflowEvent } from "@/lib/workflow/events";
import { enqueueCostingChangeAlert, nextGenBomChangedAlertBody } from "@/lib/notifications/workflow-alerts";
import { fetchBom } from "./bom";

/**
 * NextGen BOM version tracking.
 *
 * The BOM for a style lives in NextGen and has a header version
 * (HeaderVersionNumber + BomVersionComment). We snapshot the version a request
 * was created with, then periodically compare it against the live NextGen
 * BOM. When the version changes for a style with active requests, the costing
 * team is alerted through the existing change-alert flow (email + Teams +
 * in-app dashboard alert) and a workflow event is recorded so the daily
 * digest picks it up.
 */

export type BomVersionCheckResult = {
  /** Unique styles (NextGen products) compared against live BOMs. */
  checked: number;
  /** Styles whose BOM version/comment changed vs the stored snapshot. */
  changed: number;
  /** Active requests alerted because their style's BOM changed. */
  alertedRequests: number;
  /** Styles that got their baseline recorded (first check, no alert). */
  baselined: number;
  errors: string[];
};

/** Stable fingerprint of a BOM header version. */
export function bomFingerprint(version?: string | null, comment?: string | null): string {
  return `${version ?? ""}|${comment ?? ""}`.trim();
}

type ActiveStyleRow = {
  product_id: string;
  nextgen_entity_id: string;
  style_number: string | null;
  bom_version: string | null;
  bom_version_comment: string | null;
  bom_checked_at: string | null;
};

type ActiveRequestRow = {
  id: string;
  request_number: string | null;
  factory_name: string | null;
  product_id: string | null;
};

/**
 * Compare the stored BOM version of every style linked to an active request
 * against the live NextGen BOM. Returns a summary; never throws.
 */
export async function checkBomVersions(limit = 300): Promise<BomVersionCheckResult> {
  const result: BomVersionCheckResult = { checked: 0, changed: 0, alertedRequests: 0, baselined: 0, errors: [] };
  const supabase = createSupabaseServiceClient();

  try {
    // 1. Active requests + their NextGen product (style) rows.
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
      .select("id, nextgen_entity_id, style_number, bom_version, bom_version_comment, bom_checked_at")
      .in("id", productIds)
      .limit(1000);

    if (productError) {
      result.errors.push(`products: ${productError.message}`);
      return result;
    }

    const styles: ActiveStyleRow[] = ((products ?? []) as Array<Record<string, unknown>>).map((row) => ({
      product_id: String(row.id),
      nextgen_entity_id: String(row.nextgen_entity_id ?? ""),
      style_number: (row.style_number as string | null) ?? null,
      bom_version: (row.bom_version as string | null) ?? null,
      bom_version_comment: (row.bom_version_comment as string | null) ?? null,
      bom_checked_at: (row.bom_checked_at as string | null) ?? null
    }));
    const requestsByProduct = new Map<string, ActiveRequestRow[]>();
    for (const row of requestRows) {
      if (!row.product_id) continue;
      const list = requestsByProduct.get(row.product_id) ?? [];
      list.push(row);
      requestsByProduct.set(row.product_id, list);
    }

    // 2. Fetch the live BOM for each unique style (batches of 5, like the
    //    material sync) and compare fingerprints.
    const batchSize = 5;
    for (let i = 0; i < styles.length; i += batchSize) {
      const batch = styles.slice(i, i + batchSize);
      const bomResults = await Promise.allSettled(
        batch.map((style) => fetchBom({ entityId: style.nextgen_entity_id, pageSize: 200 }))
      );

      for (let j = 0; j < batch.length; j++) {
        const style = batch[j];
        const settled = bomResults[j];
        result.checked++;

        if (settled.status === "rejected" || !settled.value.ok) {
          result.errors.push(`${style.style_number ?? style.nextgen_entity_id}: BOM fetch failed`);
          continue;
        }

        const lines = settled.value.data;
        const currentVersion = lines.find((line) => line.headerVersion)?.headerVersion ?? null;
        const currentComment = lines.find((line) => line.bomVersionComment)?.bomVersionComment ?? null;

        const storedFingerprint = bomFingerprint(style.bom_version, style.bom_version_comment);
        const currentFingerprint = bomFingerprint(currentVersion, currentComment);

        // First check for this style — record the baseline, no alert.
        const firstCheck = !style.bom_version && !style.bom_checked_at;
        const changed = !firstCheck && storedFingerprint !== currentFingerprint;

        if (!changed) {
          await updateSnapshot(supabase, style.product_id, currentVersion, currentComment);
          if (firstCheck) result.baselined++;
          continue;
        }

        // Changed! Alert every active request of this style.
        result.changed++;
        const affectedRequests = requestsByProduct.get(style.product_id) ?? [];

        for (const req of affectedRequests) {
          const { subject, body } = nextGenBomChangedAlertBody({
            requestNumber: req.request_number,
            factoryName: req.factory_name,
            styleNumber: style.style_number,
            versionBefore: style.bom_version,
            versionAfter: currentVersion,
            commentAfter: currentComment
          });

          await enqueueCostingChangeAlert({
            requestId: req.id,
            requestNumber: req.request_number,
            factoryName: req.factory_name,
            subject,
            body,
            kind: "bom_changed"
          });

          await recordWorkflowEvent(supabase, {
            costingRequestId: req.id,
            eventType: "bom_changed",
            actorRole: "system",
            payload: {
              source: "nextgen_bom_version",
              versionBefore: style.bom_version,
              versionAfter: currentVersion,
              comment: currentComment,
              styleNumber: style.style_number
            }
          }).catch(() => {
            // Best-effort — never block the alert on event-recording failures.
          });

          result.alertedRequests++;
        }

        await updateSnapshot(supabase, style.product_id, currentVersion, currentComment);
      }
    }

    return result;
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : "checkBomVersions failed");
    return result;
  }
}

async function updateSnapshot(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  productId: string,
  version: string | null,
  comment: string | null
) {
  const { error } = await supabase
    .from("nextgen_products")
    .update({
      bom_version: version,
      bom_version_comment: comment,
      bom_checked_at: new Date().toISOString()
    })
    .eq("id", productId);
  if (error) throw error;
}

/** Preview: count active requests and unique styles for a BOM check. */
export async function previewBomVersionCheck(): Promise<{
  activeRequests: number;
  uniqueStyles: number;
  baselined: number;
  error?: string;
}> {
  const supabase = createSupabaseServiceClient();
  const { data: requests, error } = await supabase
    .from("costing_requests")
    .select("product_id")
    .not("status", "in", "(approved,rejected)")
    .limit(1000);

  if (error) return { activeRequests: 0, uniqueStyles: 0, baselined: 0, error: error.message };

  const productIds = [
    ...new Set(
      ((requests ?? []) as Array<{ product_id: string | null }>)
        .map((r) => r.product_id)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const uniqueStyles = productIds.length;

  const { data: products } = await supabase
    .from("nextgen_products")
    .select("id")
    .in("id", productIds)
    .not("bom_version", "is", null)
    .limit(1000);

  return {
    activeRequests: (requests ?? []).length,
    uniqueStyles,
    baselined: (products ?? []).length
  };
}
