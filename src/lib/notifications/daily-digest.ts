import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCbdDiff } from "@/lib/costing/cbd-diff";
import { resolveRoleRecipients } from "./workflow-alerts";

// Daily change digest for the Costing Team. Summarizes every BOM/CBD
// submission and PBD pricing change across active requests in the last 24h,
// and emails one digest per costing recipient via the notification_queue.
// Triggered by POST /api/notifications/daily-digest (admin or cron).

export type DigestEventType = "factory_submit" | "pbd_pricing_updated" | "bom_changed";

export type DigestEntry = {
  requestId: string;
  requestNumber: string;
  factoryName: string | null;
  status: string | null;
  eventType: DigestEventType;
  occurredAt: string;
  actorRole: string | null;
  details: string[];
};

export type DailyDigest = {
  windowStart: string;
  windowEnd: string;
  entries: DigestEntry[];
  distinctRequests: number;
};

const DIGEST_EVENT_TYPES: DigestEventType[] = ["factory_submit", "pbd_pricing_updated", "bom_changed"];

export async function getDailyDigestData(sinceHours = 24): Promise<DailyDigest> {
  const supabase = createSupabaseServiceClient();
  const windowEnd = new Date().toISOString();
  const windowStart = new Date(Date.now() - sinceHours * 3_600_000).toISOString();

  const { data: events, error } = await supabase
    .from("workflow_events")
    .select("id,costing_request_id,event_type,actor_role,created_at,payload")
    .gte("created_at", windowStart)
    .in("event_type", DIGEST_EVENT_TYPES)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) throw error;

  const typedEvents = (events ?? []) as Array<{
    id: string;
    costing_request_id: string | null;
    event_type: string;
    actor_role: string | null;
    created_at: string;
    payload: Record<string, unknown>;
  }>;

  const requestIds = [...new Set(typedEvents.map((event) => event.costing_request_id).filter(Boolean))] as string[];
  const { data: requests } = await supabase
    .from("costing_requests")
    .select("id,request_number,factory_name,status,customer,brand,season")
    .in("id", requestIds);

  const requestMap = new Map<string, Record<string, unknown>>();
  for (const row of (requests ?? []) as Array<Record<string, unknown>>) {
    requestMap.set(String(row.id), row);
  }

  const entries: DigestEntry[] = [];
  for (const event of typedEvents) {
    const request = event.costing_request_id ? requestMap.get(event.costing_request_id) : null;
    const entry: DigestEntry = {
      requestId: event.costing_request_id ?? "unknown",
      requestNumber: (request?.request_number as string | null) ?? "Unknown request",
      factoryName: (request?.factory_name as string | null) ?? null,
      status: (request?.status as string | null) ?? null,
      eventType: (DIGEST_EVENT_TYPES as string[]).includes(event.event_type)
        ? (event.event_type as DigestEventType)
        : "factory_submit",
      occurredAt: event.created_at,
      actorRole: event.actor_role ?? null,
      details: []
    };

    if (event.event_type === "factory_submit") {
      entry.details.push("Factory submitted CBD");
      if (event.costing_request_id) {
        const diff = await getCbdDiff(event.costing_request_id).catch(() => null);
        if (diff && diff.diffs.length > 0) {
          const latest = diff.diffs[diff.diffs.length - 1];
          const changedCount = latest.filter((item) => item.changed).length;
          const impact = diff.costImpacts[diff.costImpacts.length - 1];
          if (impact) {
            entry.details.push(
              "FOB: " + impact.currency + " " + impact.fobBefore.toFixed(2) + " → " + impact.currency + " " + impact.fobAfter.toFixed(2)
            );
          }
          if (changedCount > 0) entry.details.push(changedCount + " field(s) changed vs previous submission");
        }
      }
    } else if (event.event_type === "pbd_pricing_updated") {
      const pricing = event.payload?.pricing as Record<string, unknown> | undefined;
      if (pricing && typeof pricing === "object") {
        const currency = typeof pricing.currency === "string" ? pricing.currency : "USD";
        const wholesale = typeof pricing.wholesalePrice === "number" ? currency + " " + pricing.wholesalePrice.toFixed(2) : null;
        const retail = typeof pricing.retailPrice === "number" ? currency + " " + pricing.retailPrice.toFixed(2) : null;
        if (wholesale) entry.details.push("Wholesale: " + wholesale);
        if (retail) entry.details.push("Retail: " + retail);
        if (!wholesale && !retail) entry.details.push("PBD updated pricing");
      } else {
        entry.details.push("PBD updated pricing");
      }
    } else if (event.event_type === "bom_changed") {
      const changedCount = typeof event.payload?.changedCount === "number" ? event.payload.changedCount : null;
      entry.details.push(changedCount ? changedCount + " BOM field(s) changed" : "BOM changed");
    }

    entries.push(entry);
  }

  return {
    windowStart,
    windowEnd,
    entries,
    distinctRequests: requestIds.length
  };
}

/** Renders the digest as a plain-text email body. Pure — easy to unit test. */
export function renderDailyDigest(digest: DailyDigest): string {
  const lines = [
    "Smart TP Costing — Daily Change Digest",
    "Window: " + shortDate(digest.windowStart) + " → " + shortDate(digest.windowEnd) + " (UTC)",
    "",
    "Requests with changes: " + digest.distinctRequests,
    ""
  ];

  const sections: Array<[string, DigestEntry[]]> = [
    ["CBD SUBMISSIONS", digest.entries.filter((entry) => entry.eventType === "factory_submit")],
    ["BOM CHANGES", digest.entries.filter((entry) => entry.eventType === "bom_changed")],
    ["PBD PRICING CHANGES", digest.entries.filter((entry) => entry.eventType === "pbd_pricing_updated")]
  ];

  let hasContent = false;
  for (const [title, entries] of sections) {
    if (!entries.length) continue;
    hasContent = true;
    lines.push(title + " (" + entries.length + ")");
    for (const entry of entries) {
      lines.push("• " + entry.requestNumber + " — " + (entry.factoryName ?? "Unassigned") + (entry.status ? " (" + entry.status.replace(/_/g, " ") + ")" : ""));
      for (const detail of entry.details) lines.push("    " + detail);
      lines.push("    " + shortDate(entry.occurredAt) + " · " + (entry.actorRole ?? "system"));
    }
    lines.push("");
  }

  if (!hasContent) {
    lines.push("No BOM or pricing changes were recorded in this window.");
  }

  lines.push("View requests: " + (process.env.NEXT_PUBLIC_APP_URL ?? ""));
  return lines.join("\n");
}

/**
 * Builds and enqueues the daily digest email to every costing recipient.
 * Skips quietly when there is nothing to report or no recipients exist.
 */
export async function sendDailyDigest(sinceHours = 24) {
  const digest = await getDailyDigestData(sinceHours);
  if (!digest.entries.length) {
    return { ok: true, skipped: "no changes in window", enqueued: 0 };
  }

  const recipients = await resolveRoleRecipients("costing");
  if (!recipients.length) {
    return { ok: true, skipped: "no costing recipients configured", enqueued: 0 };
  }

  const subject = "[Smart TP] Daily change digest — " + digest.entries.length + " change(s)";
  const body = renderDailyDigest(digest);
  const supabase = createSupabaseServiceClient();

  let enqueued = 0;
  for (const email of recipients) {
    await supabase.from("notification_queue").insert({
      channel: "email",
      recipient: email,
      subject,
      body,
      status: "pending"
    });
    enqueued++;
  }

  return { ok: true, digest, enqueued };
}

export async function trySendDailyDigest(sinceHours = 24) {
  try {
    return { ...(await sendDailyDigest(sinceHours)), error: null };
  } catch (error) {
    return {
      ok: false,
      enqueued: 0,
      error: error instanceof Error ? error.message : "Daily digest failed"
    };
  }
}

function shortDate(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return iso;
  }
}
