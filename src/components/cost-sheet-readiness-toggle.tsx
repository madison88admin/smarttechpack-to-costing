"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { IconCheck } from "@/components/ui/icons";

export function CostSheetReadinessToggle({
  requestId,
  isReady,
  readyAt,
  readyBy,
  canToggle
}: {
  requestId: string;
  isReady: boolean;
  readyAt: string | null;
  readyBy: string | null;
  canToggle: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function toggle() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/costing/requests/${requestId}/cost-sheet-ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ready: !isReady })
      });
      const result = await response.json();
      if (response.ok && result.ok) {
        setMessage(result.ready ? "Marked as ready for NextGen" : "Marked as not ready");
        toast.add({
          type: "success",
          description: result.ready ? "Cost sheet marked as ready for NextGen" : "Cost sheet marked as not ready"
        });
        router.refresh();
      } else {
        const errMsg = result.error ?? "Failed to update";
        setMessage(errMsg);
        toast.add({ type: "error", description: errMsg, priority: "high" });
      }
    } catch {
      setMessage("Request failed");
      toast.add({ type: "error", description: "Failed to toggle cost sheet readiness", priority: "high" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h3 style={{ margin: "0 0 4px" }}>Cost Sheet Readiness <span className="eyebrow">(Post-Approval — Costing Team)</span></h3>
          {isReady ? (
            <>
              <span className="readiness-badge ready"><IconCheck size={14} /> Ready for NextGen</span>
              {readyAt ? (
                <p className="eyebrow" style={{ marginTop: 4 }}>
                  Marked ready by {readyBy ?? "—"} on {new Date(readyAt).toLocaleString()}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <span className="readiness-badge pending">Pending NextGen Preparation</span>
              <p className="eyebrow" style={{ marginTop: 4 }}>
                After PBD approval, the Costing Team prepares the final cost sheet in NextGen. Mark as ready when complete.
              </p>
            </>
          )}
        </div>
        {canToggle ? (
          <button
            className={`button ${isReady ? "secondary" : ""}`}
            onClick={toggle}
            disabled={busy}
          >
            {busy ? "Updating..." : isReady ? "Mark as Not Ready" : "Mark as Ready"}
          </button>
        ) : null}
      </div>
      {message ? <p className="form-message saved" style={{ marginTop: 8 }}>{message}</p> : null}
    </div>
  );
}
