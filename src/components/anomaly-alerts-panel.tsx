"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { IconArrowRight } from "@/components/ui/icons";
import { SkeletonTable } from "@/components/ui/skeleton";

type AnomalyAlert = {
  id: string;
  type: "cost_increase" | "factory_outlier" | "material_spike" | "margin_below_target";
  severity: "warning" | "critical";
  requestId: string;
  requestNumber: string | null;
  factoryName: string | null;
  styleNumber: string | null;
  message: string;
  currentValue: number;
  historicalAverage: number;
  variancePercent: number;
  detectedAt: string;
};

const typeLabels: Record<string, string> = {
  cost_increase: "Cost Increase",
  factory_outlier: "Factory Outlier",
  material_spike: "Material Spike",
  margin_below_target: "Low Margin"
};

export function AnomalyAlertsPanel() {
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(0);

  useEffect(() => {
    loadAlerts();
  }, []);

  async function loadAlerts() {
    setLoading(true);
    try {
      const res = await fetch("/api/analytics/anomalies");
      const data = await res.json();
      if (data.ok) {
        setAlerts(data.alerts ?? []);
        setChecked(data.checked ?? 0);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <SkeletonTable rows={3} />;

  if (alerts.length === 0) {
    return (
      <div className="anomaly-ok">
        <strong>No anomalies detected</strong>
        <p className="eyebrow">Checked {checked} recent submissions. All costs are within normal range.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: 8 }}>
        {alerts.length} alert(s) detected from {checked} recent submissions
      </p>
      <div className="anomaly-list">
        {alerts.map((alert) => (
          <div key={alert.id} className={`anomaly-card ${alert.severity}`}>
            <div className="anomaly-header">
              <span className={`anomaly-badge ${alert.severity}`}>
                {alert.severity === "critical" ? "CRITICAL" : "WARNING"}
              </span>
              <span className="anomaly-type">{typeLabels[alert.type] ?? alert.type}</span>
              {alert.requestId ? (
                <Link href={`/requests/${alert.requestId}`} className="anomaly-link">
                  View Request <IconArrowRight size={12} />
                </Link>
              ) : null}
            </div>
            <p className="anomaly-message">{alert.message}</p>
            {alert.styleNumber || alert.factoryName ? (
              <p className="eyebrow">
                {alert.styleNumber ? `Style: ${alert.styleNumber}` : ""}
                {alert.styleNumber && alert.factoryName ? " | " : ""}
                {alert.factoryName ? `Factory: ${alert.factoryName}` : ""}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
