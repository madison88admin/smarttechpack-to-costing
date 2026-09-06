"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export type AnalyticsTab = {
  id: string;
  label: string;
  /** Short count shown in a pill on the tab; tone colors it. */
  badge?: string;
  badgeTone?: "red" | "amber" | "green" | "blue";
  content: ReactNode;
};

/**
 * Collapses the dashboard's heavy analytics panels (SLA breaches, margin,
 * scorecard, savings, anomalies) behind one tab bar so the page stays short —
 * KPIs and the action queue stay visible while deep dives open on demand.
 * Content is server-rendered and passed in as serialized ReactNode props.
 */
export function AnalyticsTabs({ tabs }: { tabs: AnalyticsTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? "");
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  if (!active) return null;

  return (
    <div className="analytics-tabs">
      <div className="analytics-tab-bar" role="tablist" aria-label="Dashboard analytics">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === active.id}
            className={`analytics-tab${tab.id === active.id ? " active" : ""}`}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
            {tab.badge ? <span className={`analytics-tab-badge ${tab.badgeTone ?? ""}`}>{tab.badge}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel">{active.content}</div>
    </div>
  );
}