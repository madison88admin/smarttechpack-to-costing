"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CostingStatus } from "@/lib/workflow/status";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { IconCheck, IconX, IconAlert, IconSend, IconSearch2, IconArrowRight } from "@/components/ui/icons";

type Action = "clarify" | "reject" | "approve" | "send_to_factory" | "costing_complete" | "costing_clarify";

export function RequestActions({
  requestId,
  status,
  canAct,
  canCostingAct,
  pricingReady = true,
  openChanges = [],
  hideLinks = false
}: {
  requestId: string;
  status: CostingStatus;
  canAct: boolean;
  canCostingAct?: boolean;
  pricingReady?: boolean;
  /** Open structured change requests — surfaced as a warning, never a block. */
  openChanges?: Array<{ field: string; requestedValue: string }>;
  /** Set when embedded on the CBD view itself, where those links point here. */
  hideLinks?: boolean;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busyAction, setBusyAction] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");

  // One PBD-owned decision stage: clarify, reject, or approve.
  const showPbdReview = canAct && status === "for_pbd_review";
  const showWaitingForFactory = canAct && status === "needs_clarification";
  const showSendToFactory = canAct && status === "draft";

  // Costing Team actions — only when status is for_costing_review
  const showCostingActions = canCostingAct && status === "for_costing_review";

  async function runAction(action: Action) {
    // Confirmation for irreversible actions
    const confirmConfig: Partial<Record<Action, { title: string; message: string; variant: "danger" | "warning" | "success"; confirmLabel: string }>> = {
      approve: {
        title: "Approve Costing Request?",
        message: `This will mark the request as approved and save it to historical records. This action cannot be undone.${openChanges.length > 0 ? ` Warning: ${openChanges.length} field change request(s) still open (${openChanges.map((c) => `${c.field} → ${c.requestedValue}`).join("; ")}).` : ""}`,
        variant: "success",
        confirmLabel: "Approve"
      },
      reject: {
        title: "Reject Costing Request?",
        message: "This will permanently reject the costing request. The factory will need to start over. This action cannot be undone.",
        variant: "danger",
        confirmLabel: "Reject"
      },
      send_to_factory: {
        title: "Send to Factory?",
        message: "This will send the request to the factory for CBD submission. The factory will be notified.",
        variant: "warning",
        confirmLabel: "Send"
      },
      costing_complete: {
        title: "Complete Validation?",
        message: "This will complete Costing validation and send the request to PBD for internal approval. Make sure the validation checklist is complete.",
        variant: "warning",
        confirmLabel: "Complete"
      }
    };

    const cfg = confirmConfig[action];
    if (cfg) {
      const confirmed = await confirm({
        title: cfg.title,
        message: cfg.message,
        variant: cfg.variant,
        confirmLabel: cfg.confirmLabel
      });
      if (!confirmed) return;
    }

    setBusyAction(action);
    setError("");

    const response = await fetch(`/api/costing/requests/${requestId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, comment: comment.trim() || undefined })
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      const errMsg = result.error ?? "Action failed";
      setError(errMsg);
      toast.add({ type: "error", description: errMsg, priority: "high" });
      setBusyAction(null);
      return;
    }

    const actionLabels: Record<Action, string> = {
      approve: "Request approved successfully",
      reject: "Request rejected",
      clarify: "Clarification sent to factory",
      send_to_factory: "Request sent to factory",
      costing_complete: "Validation complete — sent to PBD",
      costing_clarify: "Clarification request sent to factory"
    };

    toast.add({
      type: action === "reject" ? "warning" : "success",
      description: actionLabels[action] ?? "Action completed"
    });

    setComment("");
    setBusyAction(null);
    router.refresh();
  }

  return (
    <div className="action-bar">
      <div className="action-bar-buttons">
        {hideLinks ? null : (
          <>
            <Link className="button secondary btn-sm" href={`/factory/${requestId}`}>
              View CBD
            </Link>
            <Link className="button secondary btn-sm" href={`/requests/${requestId}/cbd-diff`}>
              Review CBD changes
            </Link>
          </>
        )}
        {showSendToFactory ? (
          <button className="button" onClick={() => runAction("send_to_factory")} disabled={busyAction !== null}>
            {busyAction === "send_to_factory" ? <><span className="spinner" /> Sending...</> : <><IconSend size={16} /> Send to Factory</>}
          </button>
        ) : null}
      </div>

      {/* Costing Team actions — validation gate before PBD */}
      {showCostingActions ? (
        <div className="action-section costing-section">
          <div className="action-banner action-banner-costing">
            <strong><IconSearch2 size={16} /> Costing Team Validation Required</strong>
            <p>Review warnings and any Factory revision first. Use “Review CBD changes” to compare old and new values, then complete the checklist or request a correction.</p>
          </div>
          <textarea
            className="input action-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Example: Update labor cost from USD 0.50 to USD 0.65; current rate is below the agreed operation cost."
          />
          <div className="action-buttons-row">
            <button className="button secondary" onClick={() => runAction("costing_clarify")} disabled={busyAction !== null}>
              {busyAction === "costing_clarify" ? <><span className="spinner" /> Sending...</> : <><IconAlert size={16} /> Request Factory Clarification</>}
            </button>
            <button className="button" onClick={() => runAction("costing_complete")} disabled={busyAction !== null}>
              {busyAction === "costing_complete" ? <><span className="spinner" /> Completing...</> : <><IconCheck size={16} /> Complete Validation <IconArrowRight size={14} /></>}
            </button>
          </div>
        </div>
      ) : null}

      {/* Status indicator for Costing review (read-only for PBD) */}
      {status === "for_costing_review" && !showCostingActions ? (
        <div className="action-banner action-banner-info">
          <strong><IconSearch2 size={16} /> Awaiting Costing Team Validation</strong>
          <p>This request is being validated by the Costing Team. It will appear here once validation is complete.</p>
        </div>
      ) : null}

      {/* One combined PBD decision stage. */}
      {showPbdReview ? (
        <div className="action-section pbd-section">
          <div className="action-banner action-banner-warning">
            <strong><IconCheck size={16} /> PBD Review</strong>
            <p>Review the validated CBD and any Factory revision. Use “Review CBD changes” to compare previous and updated values before requesting a correction, rejecting, or approving.</p>
          </div>
          {openChanges.length > 0 ? (
            <div className="notice warning-notice">
              <strong>{openChanges.length} field change request(s) still open:</strong>{" "}
              {openChanges.map((c) => `${c.field} → ${c.requestedValue}`).join("; ")}.{" "}
              <Link className="table-action" href={`/requests/${requestId}/cbd-diff`}>Review status</Link>
            </div>
          ) : null}
          <textarea
            className="input action-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Example: Please revise standard packaging from USD 0.12 to USD 0.18 and explain the supplier quote change."
          />
          {!pricingReady ? (
            <div className="notice warning-notice">
              Enter and save the PBD selling price before approval.{" "}
              {/* Absolute, not a bare `#anchor`: this bar is also embedded on the CBD
                  view, where the pricing section lives on the request page. */}
              <a href={`/requests/${requestId}#pbd-pricing-review`}>Open Pricing Review</a>
            </div>
          ) : null}
          <div className="action-buttons-row">
            <button className="button secondary" onClick={() => runAction("clarify")} disabled={busyAction !== null}>
              {busyAction === "clarify" ? <><span className="spinner" /> Sending...</> : <><IconAlert size={16} /> Request Factory Correction</>}
            </button>
            <button className="button secondary btn-danger" onClick={() => runAction("reject")} disabled={busyAction !== null}>
              {busyAction === "reject" ? <><span className="spinner" /> Saving...</> : <><IconX size={16} /> Reject</>}
            </button>
            <button className="button btn-success" onClick={() => runAction("approve")} disabled={busyAction !== null || !pricingReady} title={!pricingReady ? "Complete PBD selling price review first" : undefined}>
              {busyAction === "approve" ? <><span className="spinner" /> Saving...</> : <><IconCheck size={16} /> Approve</>}
            </button>
          </div>
        </div>
      ) : null}
      {showWaitingForFactory ? (
        <div className="action-banner action-banner-info">
          <strong><IconAlert size={16} /> Waiting for Factory Correction</strong>
          <p>The clarification has been sent. The assigned Factory user can edit and resubmit the CBD in the Factory workspace — it returns to the team that requested the correction.</p>
        </div>
      ) : null}
      {error ? <span className="action-error">{error}</span> : null}
      {dialog}
    </div>
  );
}
