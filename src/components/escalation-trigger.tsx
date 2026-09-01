"use client";

import { useState } from "react";

export function EscalationTrigger() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function runEscalation() {
    setBusy(true);
    setMessage("Processing escalations...");
    try {
      const response = await fetch("/api/notifications/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const result = await response.json();
      if (response.ok && result.ok) {
        const e = result.escalations;
        setMessage(`${e.remindersSent} reminder(s), ${e.escalationsSent} escalation(s) sent.`);
      } else {
        setMessage(result.error ?? "Escalation processing failed");
      }
    } catch (err) {
      setMessage("Failed to process escalations");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="button" type="button" onClick={runEscalation} disabled={busy}>
        {busy ? "Processing..." : "Run Escalation Check"}
      </button>
      {message ? <span className="form-message saved">{message}</span> : null}
    </>
  );
}
