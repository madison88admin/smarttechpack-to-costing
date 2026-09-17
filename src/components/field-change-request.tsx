"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  requestId: string;
  role: string;
  status: string;
  section: string;
  field: string;
  fieldKey: string;
  currentValue: string;
};

export function FieldChangeRequest(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [requestedValue, setRequestedValue] = useState("");
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueDate, setDueDate] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const isMd = props.role === "md";
  const isCosting = props.role === "costing";
  const canRequest = (isMd && props.status === "for_md_review") || (isCosting && props.status === "for_costing_review") || ((props.role === "pbd" || props.role === "admin") && props.status === "for_pbd_review");
  if (!canRequest) return null;

  async function submit() {
    if (!requestedValue.trim() || !reason.trim()) { setMessage("Requested value and reason are required."); return; }
    setBusy(true); setMessage("");
    // Structured per-field request: persisted as a queryable row AND moves the
    // request back to the factory queue through the lane's normal transition.
    const response = await fetch(`/api/costing/requests/${props.requestId}/change-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section: props.section,
        field: props.field,
        fieldKey: props.fieldKey,
        currentValue: props.currentValue,
        requestedValue: requestedValue.trim(),
        reason: reason.trim(),
        priority,
        ...(dueDate ? { dueDate } : {})
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) { setMessage(result.error ?? "Unable to send change request."); setBusy(false); return; }
    setMessage("Change request sent to Factory."); setBusy(false); setOpen(false); router.refresh();
  }

  return <div className="field-change-request">
    <button type="button" className="button secondary small-btn" onClick={() => setOpen((value) => !value)}>Request change</button>
    {open ? <div className="field-change-form">
      <strong>Request change: {props.section} · {props.field}</strong>
      <label>Current value<input className="input" value={props.currentValue} readOnly /></label>
      <label>Requested value<input className="input" value={requestedValue} onChange={(e) => setRequestedValue(e.target.value)} placeholder="Enter the required value" /></label>
      <label>Reason / instruction<textarea className="input textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why the Factory must change this value" /></label>
      <div className="form-grid"><label>Priority<select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label>Due date (optional)<input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label></div>
      <button type="button" className="button" disabled={busy} onClick={submit}>{busy ? "Sending..." : "Send to Factory"}</button>
    </div> : null}
    {message ? <p className="form-message">{message}</p> : null}
  </div>;
}
