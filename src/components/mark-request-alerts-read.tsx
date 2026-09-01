"use client";

import { useEffect } from "react";

// Marks in-app change alerts read for a request the moment the user opens it,
// so the dashboard badge clears without any extra click.
export function MarkRequestAlertsRead({ requestId }: { requestId: string }) {
  useEffect(() => {
    fetch("/api/notifications/in-app/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestIds: [requestId] })
    }).catch(() => {
      // Best-effort — never block the page on read tracking.
    });
  }, [requestId]);

  return null;
}
