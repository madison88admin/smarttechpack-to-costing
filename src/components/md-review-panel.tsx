"use client";

import { useState } from "react";

type Review = {
  comment?: string | null;
  metadata?: unknown;
  created_at?: string;
  actor_role?: string | null;
};

export function MdReviewPanel({
  requestId,
  status,
  canEdit,
  lastReview
}: {
  requestId: string;
  status: string;
  canEdit: boolean;
  lastReview?: Review | null;
}) {
  const [decision, setDecision] = useState<"pass" | "needs_clarification">("pass");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = canEdit && status === "for_md_review";

  async function submit() {
    setBusy(true);
    setMessage("Saving MD review...");
    const response = await fetch(`/api/costing/requests/${requestId}/md-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, notes })
    });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok && result.ok ? "MD review recorded." : result.error ?? "Unable to save MD review");
    setBusy(false);
    if (response.ok && result.ok) window.location.reload();
  }

  const lastDecision = lastReview?.metadata && typeof lastReview.metadata === "object" && "decision" in lastReview.metadata
    ? String((lastReview.metadata as { decision?: unknown }).decision ?? "")
    : "";
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Merchandising gate</p>
          <h2>MD Review</h2>
        </div>
        {lastDecision ? <span className={`status ${lastDecision === "pass" ? "green" : "amber"}`}>{lastDecision === "pass" ? "Passed" : "Clarification requested"}</span> : null}
      </div>
      <p className="eyebrow">Confirm yarn, knit type, machine, and construction against the sample before PBD approval.</p>
      {lastReview ? <p className="notice">Last MD review: {lastReview.comment || "No notes"}{lastReview.created_at ? ` · ${new Date(lastReview.created_at).toLocaleString()}` : ""}</p> : null}
      {editable ? (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="md-decision">Decision</label>
            <select id="md-decision" className="input" value={decision} disabled={busy} onChange={(event) => setDecision(event.target.value as "pass" | "needs_clarification")}>
              <option value="pass">Pass MD review</option>
              <option value="needs_clarification">Request factory clarification</option>
            </select>
          </div>
          <div className="field full">
            <label htmlFor="md-notes">MD notes</label>
            <textarea id="md-notes" className="input textarea" value={notes} disabled={busy} onChange={(event) => setNotes(event.target.value)} placeholder="Operations, machine, yarn, or construction findings" />
          </div>
          <div className="form-actions"><button className="button" type="button" disabled={busy} onClick={submit}>{busy ? "Saving..." : "Record MD Review"}</button></div>
        </div>
      ) : <p className="eyebrow">MD review is editable only by MD/Admin while the request is in MD review.</p>}
      {message ? <p className={`form-message ${message.includes("recorded") ? "saved" : "error"}`}>{message}</p> : null}
    </section>
  );
}
