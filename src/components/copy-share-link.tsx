"use client";

import { useState } from "react";

/** Copy-to-clipboard button for a shareable link. */
export function CopyShareLink({ url, label = "Copy link" }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!url) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — fall back to showing the raw URL.
      setCopied(false);
    }
  }

  return (
    <button className="button secondary small-btn" onClick={copy}>
      {copied ? "Copied!" : label}
    </button>
  );
}
