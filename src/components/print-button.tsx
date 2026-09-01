"use client";

export function PrintButton({ label = "Export PDF" }: { label?: string }) {
  return (
    <button type="button" className="button secondary btn-sm" onClick={() => window.print()}>
      {label}
    </button>
  );
}
