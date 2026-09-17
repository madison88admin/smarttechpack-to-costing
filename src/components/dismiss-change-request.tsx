"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DismissChangeRequest({ requestId, changeId }: { requestId: string; changeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function dismiss() {
    if (!window.confirm("Dismiss this change request? The factory deviation stays as-is.")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/costing/requests/${requestId}/change-requests`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: changeId, status: "dismissed" })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        setMessage(result.error ?? "Unable to dismiss.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" className="button secondary small-btn" onClick={dismiss} disabled={busy}>
        {busy ? "Dismissing…" : "Dismiss"}
      </button>
      {message ? <span className="action-error">{message}</span> : null}
    </span>
  );
}
