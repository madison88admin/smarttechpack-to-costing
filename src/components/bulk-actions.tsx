"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";

type BulkActionResult = {
  ok: boolean;
  action: string;
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{ id: string; requestNumber: string | null; ok: boolean; error?: string; note?: string }>;
};

type BulkActionsProps = {
  canPbdAct: boolean;
  canCostingAct: boolean;
};

export function BulkActions({ canPbdAct, canCostingAct }: BulkActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkActionResult | null>(null);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const canAct = canPbdAct || canCostingAct;

  const getSelectedFromForm = useCallback((): string[] => {
    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[name="selectedIds"]:checked');
    return Array.from(checkboxes).map((cb) => cb.value);
  }, []);

  const performAction = useCallback(
    async (action: string) => {
      const ids = getSelectedFromForm();
      if (ids.length === 0) {
        setResult({
          ok: false,
          action,
          total: 0,
          succeeded: 0,
          failed: 0,
          results: []
        });
        setShowConfirm(null);
        return;
      }

      setBusy(true);
      setResult(null);
      try {
        const res = await fetch("/api/costing/requests/bulk-actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            requestIds: ids,
            comment: action === "approve" ? "Bulk approved" : action === "send_to_factory" ? "Bulk sent to factory" : undefined
          })
        });
        const data: BulkActionResult = await res.json();
        setResult(data);
        if (data.succeeded > 0) {
          // Uncheck all checkboxes
          document.querySelectorAll<HTMLInputElement>('input[name="selectedIds"]:checked').forEach((cb) => {
            cb.checked = false;
          });
          const actionLabels: Record<string, string> = {
            approve: `${data.succeeded} request(s) approved`,
            cost_sheet_ready: `${data.succeeded} request(s) marked as Cost Sheet Ready`,
            send_to_factory: `${data.succeeded} request(s) sent to factory`
          };
          toast.add({
            type: data.failed > 0 ? "warning" : "success",
            description: actionLabels[action] ?? `${data.succeeded} action(s) completed`
          });
          router.refresh();
        }
        if (data.failed > 0 && data.succeeded === 0) {
          toast.add({
            type: "error",
            description: `${data.failed} request(s) failed — see details`,
            priority: "high"
          });
        }
      } catch {
        setResult({
          ok: false,
          action,
          total: ids.length,
          succeeded: 0,
          failed: ids.length,
          results: []
        });
        toast.add({ type: "error", description: "Bulk action failed — network error", priority: "high" });
      } finally {
        setBusy(false);
        setShowConfirm(null);
      }
    },
    [getSelectedFromForm, router]
  );

  if (!canAct) return null;

  const hasFailures = result && result.failed > 0;

  return (
    <div className="bulk-actions" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
      <span className="eyebrow">Bulk Actions:</span>

      {canPbdAct ? (
        <button
          className="button secondary small-btn"
          disabled={busy}
          onClick={() => setShowConfirm("send_to_factory")}
        >
          {busy && showConfirm === "send_to_factory" ? "Sending..." : "Send to Factory"}
        </button>
      ) : null}

      {canPbdAct ? (
        <button
          className="button small-btn"
          disabled={busy}
          onClick={() => setShowConfirm("approve")}
          style={{ background: "#15803d", borderColor: "#15803d", color: "#fff" }}
        >
          {busy && showConfirm === "approve" ? "Approving..." : "Approve Selected"}
        </button>
      ) : null}

      {canCostingAct ? (
        <button
          className="button secondary small-btn"
          disabled={busy}
          onClick={() => setShowConfirm("cost_sheet_ready")}
        >
          {busy && showConfirm === "cost_sheet_ready" ? "Marking..." : "Mark Cost Sheet Ready"}
        </button>
      ) : null}

      {result ? (
        <span style={{ fontSize: "0.85rem" }}>
          <strong className={hasFailures ? "text-amber" : "text-green"}>
            {result.succeeded} succeeded, {result.failed} failed
          </strong>
          {hasFailures && result.results.length > 0 ? (
            <>
              {" "}
              <button
                className="button secondary small-btn"
                style={{ fontSize: "0.8rem", padding: "2px 8px" }}
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? "Hide" : "Details"}
              </button>
            </>
          ) : null}
        </span>
      ) : null}

      {showDetails && result ? (
        <div
          style={{
            width: "100%",
            marginTop: 8,
            padding: 12,
            background: "var(--surface-2, #f8f9fa)",
            borderRadius: 8,
            border: "1px solid var(--border, #e0e0e0)"
          }}
        >
          <table className="table compact">
            <thead>
              <tr>
                <th>Request</th>
                <th>Result</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {result.results.map((r, i) => (
                <tr key={i}>
                  <td>{r.requestNumber ?? r.id}</td>
                  <td className={r.ok ? "text-green" : "text-red"}>{r.ok ? "OK" : "Failed"}</td>
                  <td style={{ fontSize: "0.8rem", color: "#6b7280" }}>{r.error ?? r.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showConfirm ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100
          }}
          onClick={() => !busy && setShowConfirm(null)}
        >
          <div
            className="panel"
            style={{ background: "#fff", padding: 24, borderRadius: 8, maxWidth: 400 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 8px 0" }}>Confirm Bulk Action</h3>
            <p style={{ fontSize: "0.9rem", color: "#6b7280" }}>
              {showConfirm === "approve"
                ? "Approve all selected requests? This will mark them as approved and notify stakeholders."
                : showConfirm === "cost_sheet_ready"
                  ? "Mark all selected requests as Cost Sheet Ready?"
                  : "Send all selected requests to factory?"}
            </p>
            <div className="form-actions" style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <button className="button secondary" onClick={() => setShowConfirm(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => performAction(showConfirm)}
                style={
                  showConfirm === "approve"
                    ? { background: "#15803d", borderColor: "#15803d", color: "#fff" }
                    : {}
                }
              >
                {busy ? "Processing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
