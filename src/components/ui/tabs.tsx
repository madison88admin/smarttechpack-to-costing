"use client";

import { useState, type ReactNode } from "react";

interface TabsProps {
  tabs: Array<{
    id: string;
    label: string;
    count?: number;
    content: ReactNode;
  }>;
}

export function Tabs({ tabs }: TabsProps) {
  const [active, setActive] = useState(tabs[0]?.id);

  return (
    <div className="tabs-container">
      <div className="tabs-bar" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            className={`tab-btn ${active === tab.id ? "tab-active" : ""}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 ? (
              <span className="tab-count">{tab.count}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="tab-content" role="tabpanel">
        {tabs.find((t) => t.id === active)?.content}
      </div>
    </div>
  );
}
