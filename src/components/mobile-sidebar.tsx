"use client";

import { useState, useEffect } from "react";
import { SidebarNav } from "@/components/sidebar-nav";

export function MobileSidebar({ role, userName, roleLabel }: { role: string; userName: string; roleLabel: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    const tables = document.querySelectorAll<HTMLTableElement>(".table");
    tables.forEach((table) => {
      const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
      table.querySelectorAll("tbody tr").forEach((tr) => {
        Array.from(tr.children).forEach((td, i) => {
          const el = td as HTMLElement;
          if (!el.getAttribute("data-label") && headers[i]) el.setAttribute("data-label", headers[i]);
        });
      });
    });
  }, []);

  return (
    <>
      <button
        className="mobile-menu-toggle"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={`hamburger ${open ? "open" : ""}`} aria-hidden="true"><span /><span /><span /></span>
      </button>
      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`sidebar ${open ? "open" : ""}`} role="navigation" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark">TP</span>
          <span>Smart TP<small>Costing Approval</small></span>
        </div>
        <div className="role-badge">Role: {roleLabel}</div>
        <SidebarNav role={role} userName={userName} />
      </aside>
    </>
  );
}
