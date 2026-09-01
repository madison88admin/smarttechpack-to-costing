import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { recordInAppAlert } from "@/lib/notifications/in-app";
import { resolveRoleRecipients } from "@/lib/notifications/workflow-alerts";

/**
 * Re-flags active requests when a curated benchmark price changes.
 *
 * When MD / Costing / Admin updates a master-material reference, every active
 * request whose latest submitted CBD contains a matching material line priced
 * above the NEW benchmark (30% tolerance, same as MD review) is alerted
 * in-app to the costing + MD queues and an email is enqueued for the costing
 * team. The idea: a benchmark change can turn previously-acceptable quotes
 * into outliers, so reviewers must re-validate before approving.
 *
 * The pure matching logic (findAffectedLines) is unit-tested; the DB/alerts
 * wrapper is best-effort and never throws.
 */

/** How far above the benchmark average a line must be to count as affected. */
const OVER_BENCHMARK_PERCENT = 30;

export type AffectedLineInput = {
  materialName: string | null;
  unitCost: number | null;
};

export type AffectedRequest = {
  requestId: string;
  requestNumber: string | null;
  factoryName: string | null;
  status: string;
  lines: AffectedLineInput[];
};

export type AffectedHit = {
  request: AffectedRequest;
  materialName: string | null;
  unitCost: number;
  variancePercent: number;
};

function normLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim().replace(/\s+/g, " ").toLowerCase();
  return trimmed || null;
}

/**
 * Pure matching: which requests' lines are now over the updated benchmark?
 * Mirrors findBenchmarkLine — exact normalized match or prefix (e.g. "100%
 * Acrylic ..." vs "100% Acrylic").
 */
export function findAffectedLines(
  requests: AffectedRequest[],
  input: { label: string; newAverage: number; variancePercent?: number }
): AffectedHit[] {
  const label = normLabel(input.label);
  if (!label || !Number.isFinite(input.newAverage) || input.newAverage <= 0) return [];
  const threshold = input.newAverage * (1 + (input.variancePercent ?? OVER_BENCHMARK_PERCENT) / 100);

  const hits: AffectedHit[] = [];
  for (const request of requests) {
    for (const line of request.lines) {
      if (typeof line.unitCost !== "number" || !Number.isFinite(line.unitCost) || line.unitCost <= 0) continue;
      const key = normLabel(line.materialName);
      if (!key) continue;
      if (key !== label && !key.startsWith(label) && !label.startsWith(key)) continue;
      if (line.unitCost <= threshold) continue;
      const variancePercent = ((line.unitCost - input.newAverage) / input.newAverage) * 100;
      hits.push({ request, materialName: line.materialName, unitCost: line.unitCost, variancePercent });
    }
  }
  return hits;
}

export type BenchmarkChangeInput = {
  label: string;
  category: "material" | "operation" | "knitting";
  oldAverage: number | null;
  newAverage: number | null;
  changedBy: string | null;
  notes: string | null;
};

export async function reflagRequestsForBenchmarkChange(
  input: BenchmarkChangeInput
): Promise<{ affectedRequests: number; affectedLines: number; alerted: boolean }> {
  try {
    if (input.newAverage === null || !Number.isFinite(input.newAverage) || input.newAverage <= 0) {
      return { affectedRequests: 0, affectedLines: 0, alerted: false };
    }

    const supabase = createSupabaseServiceClient();
    // Active = anything still in the pipeline (draft through pending approval).
    const { data, error } = await supabase
      .from("costing_requests")
      .select(
        `
        id,
        request_number,
        factory_name,
        status,
        factory_cbds (
          status,
          submitted_at,
          cbd_material_lines (
            material_name,
            unit_cost
          )
        )
      `
      )
      .not("status", "in", "('approved','rejected')")
      .limit(1000);

    if (error) {
      console.error("[benchmark-reflag] could not load requests:", error.message);
      return { affectedRequests: 0, affectedLines: 0, alerted: false };
    }

    const requests: AffectedRequest[] = (data ?? []).map((item: Record<string, unknown>) => {
      const cbds = Array.isArray(item.factory_cbds) ? (item.factory_cbds as Array<Record<string, unknown>>) : [];
      const latest = [...cbds].sort((a, b) =>
        String(b.submitted_at ?? "").localeCompare(String(a.submitted_at ?? ""))
      )[0];
      const lines = (latest?.cbd_material_lines as Array<Record<string, unknown>> | null) ?? [];
      return {
        requestId: String(item.id),
        requestNumber: typeof item.request_number === "string" ? item.request_number : null,
        factoryName: typeof item.factory_name === "string" ? item.factory_name : null,
        status: String(item.status ?? "draft"),
        lines: lines.map((line) => ({
          materialName: typeof line.material_name === "string" ? line.material_name : null,
          unitCost: typeof line.unit_cost === "number" ? line.unit_cost : null
        }))
      };
    });

    const hits = findAffectedLines(requests, { label: input.label, newAverage: input.newAverage });
    if (!hits.length) return { affectedRequests: 0, affectedLines: 0, alerted: false };

    // Group by request so each request gets one alert listing its affected lines.
    const byRequest = new Map<string, AffectedHit[]>();
    for (const hit of hits) {
      const list = byRequest.get(hit.request.requestId) ?? [];
      list.push(hit);
      byRequest.set(hit.request.requestId, list);
    }

    const direction =
      input.oldAverage === null ? "introduced" : input.newAverage > input.oldAverage ? "raised" : "lowered";
    const unit = input.category === "knitting" ? "min" : "USD";
    const recipients = await resolveRoleRecipients("costing");
    const linkBase = process.env.NEXT_PUBLIC_APP_URL ?? "";

    for (const [requestId, requestHits] of byRequest) {
      const first = requestHits[0].request;
      const title = `[${first.requestNumber ?? "Request"}] Benchmark updated — material now over reference`;
      const linesText = requestHits
        .map((hit) => `• ${hit.materialName ?? "Unknown"}: ${hit.unitCost} ${unit} (+${hit.variancePercent.toFixed(1)}% above new average)`)
        .join("\n");
      const body = [
        `Request: ${first.requestNumber ?? "Unknown"}`,
        `Factory: ${first.factoryName ?? "Unassigned"}`,
        `Benchmark: ${input.label} (${input.category})`,
        `Average: ${input.oldAverage === null ? "— (new)" : `${input.oldAverage} ${unit}`} → ${input.newAverage} ${unit} (${direction})`,
        ``,
        `Affected line(s) in the latest CBD:`,
        linesText,
        ``,
        `The curated benchmark was updated. These lines are now above the reference — please re-validate before approval.`
      ].join("\n");

      // In-app alerts to the queues that see the benchmark (Costing + MD).
      for (const role of ["costing", "md"]) {
        await recordInAppAlert({
          requestId,
          alertType: "benchmark_updated",
          recipientRole: role,
          title,
          body,
          payload: {
            label: input.label,
            category: input.category,
            oldAverage: input.oldAverage,
            newAverage: input.newAverage,
            affectedLines: requestHits.length
          }
        });
      }

      // Email to the costing team (best-effort, same channel as change alerts).
      for (const email of recipients) {
        await supabase.from("notification_queue").insert({
          costing_request_id: requestId,
          channel: "email",
          recipient: email,
          subject: title,
          body: `${body}\n\nView request: ${linkBase}/requests/${requestId}`,
          status: "pending"
        });
      }
    }

    return {
      affectedRequests: byRequest.size,
      affectedLines: hits.length,
      alerted: true
    };
  } catch (error) {
    console.error("[benchmark-reflag] failed:", error instanceof Error ? error.message : error);
    return { affectedRequests: 0, affectedLines: 0, alerted: false };
  }
}
