"use client";

import { useState } from "react";
import { HBarChart, type BarItem } from "@/components/charts";

type Item = BarItem & { href?: string };

export function PaginatedHBarChart({
  items,
  mainLabel = "Requests",
  subLabel = "Approved",
  pageSize = 5,
}: {
  items: Item[];
  mainLabel?: string;
  subLabel?: string;
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = items.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return (
    <>
      <HBarChart
        items={visible}
        mainLabel={mainLabel}
        subLabel={subLabel}
        rowHref={(item) => visible.find((row) => row.label === item.label)?.href ?? ""}
      />
      {pageCount > 1 ? (
        <div className="pagination-controls" aria-label={`${mainLabel} pagination`}>
          <button className="button secondary btn-sm" type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0}>Previous</button>
          <span className="eyebrow">{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, items.length)} of {items.length}</span>
          <button className="button secondary btn-sm" type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage === pageCount - 1}>Next 5</button>
        </div>
      ) : null}
    </>
  );
}
