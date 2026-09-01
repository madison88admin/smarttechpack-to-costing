"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconAlertCircle, IconCheckCircle, IconClock, IconX } from "@/components/ui/icons";

type InAppAlert = {
  id: string;
  costingRequestId: string;
  alertType: string;
  title: string;
  body: string | null;
  createdAt: string;
  requestNumber: string | null;
  factoryName: string | null;
  status: string | null;
};

const typeIcon = { bom_changed: IconAlertCircle, pbd_pricing_updated: IconClock, role_change: IconCheckCircle } as const;
const typeColor = {
  bom_changed: "var(--amber, #a76112)",
  pbd_pricing_updated: "var(--blue, #2f617f)",
  role_change: "var(--green, #3c6b3f)"
} as const;
const typeLabel = {
  bom_changed: "BOM change",
  pbd_pricing_updated: "Pricing update",
  role_change: "Action needed"
} as const;

export function ChangeAlertsPanel() {
  const [alerts, setAlerts] = useState<InAppAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/in-app", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) setAlerts(data.alerts ?? []);
    } catch {
      // Silent — the panel simply hides when alerts cannot load.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  async function markAllRead() {
    if (marking) return;
    setMarking(true);
    try {
      await fetch("/api/notifications/in-app/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      setAlerts([]);
      router.refresh();
    } catch {
      // Silent
    } finally {
      setMarking(false);
    }
  }

  if (!loading && alerts.length === 0) return null;

  return (
    <section className="panel inapp-panel" style={{ marginTop: 12 }}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Change alerts</p>
          <h2>BOM &amp; Pricing Changes</h2>
        </div>
        <div className="section-heading-right">
          {alerts.length > 0 ? (
            <button className="button secondary btn-sm" onClick={markAllRead} disabled={marking}>
              {marking ? "Marking..." : "Mark all read"}
            </button>
          ) : null}
        </div>
      </div>
      {loading ? (
        <p className="eyebrow">Loading alerts...</p>
      ) : (
        <div className="inapp-list">
          {alerts.map((alert) => {
            const Icon = typeIcon[alert.alertType as keyof typeof typeIcon] ?? IconAlertCircle;
            const color = typeColor[alert.alertType as keyof typeof typeColor] ?? "var(--blue, #2f617f)";
            const label = typeLabel[alert.alertType as keyof typeof typeLabel] ?? alert.alertType.replace(/_/g, " ");
            return (
              <Link
                key={alert.id}
                href={`/requests/${alert.costingRequestId}`}
                className="inapp-item"
                onClick={() => router.refresh()}
              >
                <span className="notif-icon" style={{ color }}>
                  <Icon size={16} />
                </span>
                <div className="inapp-content">
                  <strong>{alert.title}</strong>
                  <span>
                    {alert.requestNumber ?? "Request"} · {alert.factoryName ?? "Unassigned"}
                    {alert.status ? ` · ${alert.status.replace(/_/g, " ")}` : ""}
                  </span>
                  <small>
                    {label} · {new Date(alert.createdAt).toLocaleString()}
                  </small>
                </div>
                <IconX size={14} className="inapp-chevron" />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
