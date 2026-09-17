"use client";

import { useState } from "react";
import type { RequestComment, RequestCommentType } from "@/lib/costing/request-comments";

const copy = {
  comment: { title: "Comments", description: "Shared request context visible to the working team." },
  buyer_comment: { title: "Buyer Comments", description: "PBD/Admin notes for buyer, pricing, and commercial decisions." },
  factory_comment: { title: "Factory Comments", description: "Factory notes about CBD inputs, materials, timing, or production constraints." }
} as const;

export function RequestCommentsPanel({ requestId, initialComments, role }: { requestId: string; initialComments: RequestComment[]; role: string }) {
  const [comments, setComments] = useState(initialComments);
  const [drafts, setDrafts] = useState<Record<RequestCommentType, string>>({ comment: "", buyer_comment: "", factory_comment: "" });
  const [saving, setSaving] = useState<RequestCommentType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canWrite = role !== "viewer";
  const types: RequestCommentType[] = role === "factory"
    ? ["comment", "factory_comment"]
    : ["admin", "superadmin"].includes(role)
      ? ["comment", "buyer_comment", "factory_comment"]
      : role === "pbd"
        ? ["comment", "buyer_comment"]
        : ["comment"];
  // The route refuses the read-only Viewer outright (403), so the panel must not
  // offer a box whose Save can only fail. The thread stays readable for every
  // role; only the write affordance follows the route's rule.

  async function add(type: RequestCommentType) {
    const note = drafts[type].trim();
    if (!note) return;
    setSaving(type); setError(null);
    try {
      const response = await fetch(`/api/costing/requests/${requestId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, note }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Unable to save comment");
      setComments(current => [body.data, ...current]);
      setDrafts(current => ({ ...current, [type]: "" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save comment"); }
    finally { setSaving(null); }
  }
  return <section className="panel request-comments-panel">
    <div className="section-heading"><div><p className="eyebrow">Request communication</p><h2>Comments</h2></div><span className="eyebrow">Saved to request audit trail</span></div>
    <p className="eyebrow">Use the right comment type so the next person knows what the note is for.</p>
    {!canWrite ? <p className="eyebrow">Read-only — your role can read this thread but cannot add comments.</p> : null}
    {types.map(type => <div key={type} className="request-comment-group"><strong>{copy[type].title}</strong><p className="eyebrow">{copy[type].description}</p>
      {canWrite ? <>
        <textarea className="input textarea" value={drafts[type]} maxLength={2000} placeholder={`Add ${copy[type].title.toLowerCase()}...`} onChange={e => setDrafts(current => ({ ...current, [type]: e.target.value }))} />
        <button type="button" className="button secondary btn-sm" onClick={() => add(type)} disabled={saving === type || !drafts[type].trim()}>{saving === type ? "Saving..." : `Save ${copy[type].title}`}</button>
      </> : null}
      <ul className="list compact-list">{comments.filter(comment => comment.note_type === type).map(comment => <li key={comment.id}><strong>{comment.created_by_role ?? "System"}</strong><span className="eyebrow"> · {new Date(comment.created_at).toLocaleString()}</span><br />{comment.note}</li>)}{!comments.some(comment => comment.note_type === type) ? <li className="eyebrow">No {copy[type].title.toLowerCase()} yet.</li> : null}</ul>
    </div>)}
    {error ? <p className="notice warning-notice">{error}</p> : null}
  </section>;
}
