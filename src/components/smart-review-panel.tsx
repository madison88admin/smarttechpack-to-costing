"use client";

import { useState, useEffect } from "react";
import type { SmartReview } from "@/lib/ai/smart-review";
import type { OutlierAcknowledgement } from "@/lib/costing/outlier-review";
import { isOutlierAcknowledgementValid } from "@/lib/costing/outlier-review";
import { SkeletonText } from "@/components/ui/skeleton";

export function SmartReviewPanel({
  review,
  requestId,
  canAcknowledge = false,
  lastAcknowledgement = null,
  cbdSubmittedAt = null
}: {
  review: SmartReview;
  requestId?: string;
  canAcknowledge?: boolean;
  lastAcknowledgement?: OutlierAcknowledgement | null;
  cbdSubmittedAt?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiAction, setAiAction] = useState<string | null>(null);
  const [aiComment, setAiComment] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [ackComment, setAckComment] = useState("");
  const [acknowledging, setAcknowledging] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  // Client-side LLM enhancement (non-blocking)
  function enhanceWithAI() {
    if (!requestId) return;
    setEnhancing(true);
    setAiError(null);

    fetch("/api/ai/smart-review-enhance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        riskLevel: review.riskLevel,
        highlights: review.highlights.join("; "),
        variancePercent: null
      })
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.data) {
          setAiSummary(data.data.summary || null);
          setAiAction(data.data.action || null);
          setAiComment(data.data.comment || null);
          setEnhanced(true);
        } else {
          setAiError(data.error || "Enhancement failed");
        }
      })
      .catch(() => setAiError("Unable to connect to AI service"))
      .finally(() => setEnhancing(false));
  }

  function copySuggestion() {
    const text = `${aiAction || review.suggestedAction}\n\n${aiComment || review.suggestedComment}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Costing acknowledges the high-risk outlier flags — this is what unblocks
  // the PBD approval gate. A revised CBD invalidates the acknowledgment.
  async function acknowledgeOutliers() {
    if (!requestId) return;
    setAcknowledging(true);
    setAckError(null);
    try {
      const response = await fetch(`/api/costing/requests/${requestId}/outlier-acknowledgement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: ackComment.trim() || undefined })
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        setAckError(body.error ?? "Unable to acknowledge outliers");
      } else {
        setAcknowledged(true);
        setAckComment("");
      }
    } catch {
      setAckError("Unable to acknowledge outliers — check the connection and retry.");
    } finally {
      setAcknowledging(false);
    }
  }

  return (
    <section className="panel smart-review">
      <div className="toolbar">
        <div>
          <p className="eyebrow">AI Assist</p>
          <h2>Smart Cost Review</h2>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {enhanced ? <span className="status green">AI Enhanced</span> : null}
          <span className={`status ${riskClass(review.riskLevel)}`}>{review.riskLevel.toUpperCase()} RISK</span>
        </div>
      </div>

      <p>{aiSummary || review.summary}</p>

      {!enhanced && !enhancing && requestId ? (
        <button className="button secondary small-btn" onClick={enhanceWithAI} style={{ marginBottom: 12 }}>
          Enhance with AI
        </button>
      ) : null}
      {enhancing ? (
        <div style={{ marginBottom: 12 }}>
          <SkeletonText />
          <p className="eyebrow" style={{ marginTop: 8 }}>
            <span className="spinner" /> AI analyzing cost data... (this may take 30-60 seconds)
          </p>
        </div>
      ) : null}
      {aiError ? <p className="notice">{aiError}. Using rule-based analysis.</p> : null}

      <h3>Highlights</h3>
      <ul className="list compact-list">
        {review.highlights.map((highlight) => (
          <li key={highlight}>{highlight}</li>
        ))}
      </ul>

      <div className="suggestion-box">
        <strong>Suggested PBD action</strong>
        <p>{aiAction || review.suggestedAction}</p>
        <strong>Suggested comment</strong>
        <p>{aiComment || review.suggestedComment}</p>
        <button className="button secondary small-btn" onClick={copySuggestion}>
          {copied ? "Copied!" : "Copy Suggestion"}
        </button>
      </div>

      {lastAcknowledgement ? (
        <div
          className={`outlier-acknowledgement ack-info ${
            isOutlierAcknowledgementValid(lastAcknowledgement, cbdSubmittedAt) ? "ack-valid" : "ack-stale"
          }`}
        >
          <strong>
            {isOutlierAcknowledgementValid(lastAcknowledgement, cbdSubmittedAt)
              ? "Outliers acknowledged — approval gate released"
              : "Outlier acknowledgment is stale (CBD was revised after it)"}
          </strong>
          <p className="eyebrow">
            {lastAcknowledgement.actorName ?? lastAcknowledgement.actorRole ?? "Costing"} ·{" "}
            {formatDate(lastAcknowledgement.acknowledgedAt)}
          </p>
          {lastAcknowledgement.justification ? (
            <p className="ack-justification">“{lastAcknowledgement.justification}”</p>
          ) : null}
          {lastAcknowledgement.flags.length > 0 ? (
            <p className="eyebrow">Acknowledged flags: {lastAcknowledgement.flags.length}</p>
          ) : null}
        </div>
      ) : null}

      {review.riskLevel === "high" && canAcknowledge && requestId ? (
        <div className="outlier-acknowledgement">
          <strong>Blocking outliers — acknowledge to release for PBD approval</strong>
          <p className="eyebrow">
            PBD approval is blocked while these flags are active. Recording your review here (with justification)
            unblocks it; a revised CBD resets the acknowledgment.
          </p>
          {acknowledged ? (
            <p className="status green">Outliers acknowledged — recorded in the audit trail.</p>
          ) : (
            <>
              <input
                className="input"
                placeholder="Justification (e.g. premium yarn, wash-down sample variance)..."
                value={ackComment}
                onChange={(e) => setAckComment(e.target.value)}
                disabled={acknowledging}
              />
              <button
                className="button secondary small-btn"
                onClick={acknowledgeOutliers}
                disabled={acknowledging}
                style={{ marginTop: 8 }}
              >
                {acknowledging ? "Recording..." : "Acknowledge Outliers"}
              </button>
            </>
          )}
          {ackError ? <p className="action-error">{ackError}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function riskClass(risk: SmartReview["riskLevel"]) {
  if (risk === "high") return "red";
  if (risk === "medium") return "amber";
  return "green";
}

function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
