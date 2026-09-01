import { IconBox, IconUser } from "./icons";

/**
 * Skeleton loading components — pure CSS, no Tailwind dependency.
 * Three variants matching the Flowbite skeleton patterns:
 * 1. SkeletonTable — rows of varying-width bars (for tables/lists)
 * 2. SkeletonCard — image placeholder + text lines (for cards/panels)
 * 3. SkeletonText — centered text + avatar (for inline/centered loading)
 */

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  const widths = ["w-32", "w-24", "w-full", "w-full", "w-24", "w-32", "w-80", "w-full"];
  const maxWidths = ["", "", "max-w-lg", "max-w-md", "", "max-w-sm", "max-w-sm", ""];

  return (
    <div role="status" className="skeleton skeleton-table">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`skeleton-row ${maxWidths[i % maxWidths.length]}`}>
          <div className={`skeleton-bar ${widths[(i * 3) % widths.length]}`} />
          <div className={`skeleton-bar ${widths[(i * 3 + 1) % widths.length]}`} />
          <div className={`skeleton-bar ${widths[(i * 3 + 2) % widths.length]}`} />
        </div>
      ))}
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div role="status" className="skeleton skeleton-card">
      <div className="skeleton-image">
        <IconBox size={44} />
        <span className="sr-only">Loading...</span>
      </div>
      <div className="skeleton-bar w-48 mb-4" />
      <div className="skeleton-bar w-full mb-2" />
      <div className="skeleton-bar w-full mb-2" />
      <div className="skeleton-bar w-full" />
      <div className="skeleton-card-footer">
        <IconUser size={32} />
        <div className="skeleton-card-footer-text">
          <div className="skeleton-bar w-32 mb-2" />
          <div className="skeleton-bar w-48" />
        </div>
      </div>
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export function SkeletonText() {
  return (
    <div role="status" className="skeleton skeleton-text">
      <div className="skeleton-bar w-640 mb-2 mx-auto" />
      <div className="skeleton-bar w-540 mx-auto" />
      <div className="skeleton-text-footer">
        <IconUser size={28} />
        <div className="skeleton-bar w-20" />
        <div className="skeleton-bar w-24 thin" />
      </div>
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export function SkeletonMetric({ count = 4 }: { count?: number }) {
  return (
    <div className="grid metrics">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="metric skeleton-metric" role="status">
          <div className="skeleton-bar w-24 mb-3" />
          <div className="skeleton-bar w-16 mb-2" />
          <div className="skeleton-bar w-32 thin" />
          <span className="sr-only">Loading...</span>
        </div>
      ))}
    </div>
  );
}

export function SkeletonDetail() {
  return (
    <div role="status" className="skeleton skeleton-detail">
      <div className="skeleton-detail-header">
        <div className="skeleton-bar w-16 mb-2" />
        <div className="skeleton-bar w-48 mb-3" />
        <div className="skeleton-detail-meta">
          <div className="skeleton-bar w-20" />
          <div className="skeleton-bar w-24" />
          <div className="skeleton-bar w-16" />
        </div>
      </div>
      <div className="split">
        <div className="panel skeleton-panel">
          <div className="skeleton-bar w-32 mb-4" />
          <div className="skeleton-bar w-full mb-2" />
          <div className="skeleton-bar w-full mb-2" />
          <div className="skeleton-bar w-3q mb-2" />
          <div className="skeleton-bar w-full mb-2" />
          <div className="skeleton-bar w-half mb-2" />
          <div className="skeleton-bar w-full" />
        </div>
        <div className="panel skeleton-panel">
          <div className="skeleton-bar w-24 mb-4" />
          <div className="skeleton-bar w-full mb-2" />
          <div className="skeleton-bar w-3q mb-2" />
          <div className="skeleton-bar w-full" />
        </div>
      </div>
      <span className="sr-only">Loading...</span>
    </div>
  );
}
