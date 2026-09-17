"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { UserRole } from "@/lib/auth/roles";
import {
  IconDashboard,
  IconPlus,
  IconLayers,
  IconFactory,
  IconBox,
  IconDollar,
  IconChart,
  IconHistory,
  IconCheck,
  IconSettings,
  IconAudit,
  IconAlert,
  IconFileText
} from "@/components/ui/icons";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  roles: UserRole[];
  section: string;
};

// Super Admin sees ONLY the System section (Admin Settings, Audit Logs, Error Logs).
// Main / Data / Quality sections are for operational roles only.
const nav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: IconDashboard, roles: ["admin", "pbd", "costing", "factory", "md", "viewer"], section: "Main" },
  { href: "/requests", label: "All Requests", icon: IconLayers, roles: ["admin", "pbd", "costing", "factory", "md", "viewer"], section: "Main" },
   { href: "/cbd", label: "CBD Review", icon: IconFileText, roles: ["admin", "pbd", "costing", "md"], section: "Main" },
   { href: "/requests/new", label: "Create Request", icon: IconPlus, roles: ["admin", "pbd"], section: "Main" },
  { href: "/requests/bulk", label: "Bulk Create", icon: IconLayers, roles: ["admin", "pbd"], section: "Main" },
  { href: "/requests/import", label: "Import CBD Excel", icon: IconPlus, roles: ["admin", "pbd"], section: "Main" },
  { href: "/factory", label: "Factory View", icon: IconFactory, roles: ["admin", "factory"], section: "Main" },
  { href: "/production", label: "Production View", icon: IconBox, roles: ["admin", "pbd", "costing", "md", "viewer"], section: "Data" },
  { href: "/reports", label: "Reporting Dashboard", icon: IconChart, roles: ["admin", "pbd", "costing", "md", "viewer"], section: "Data" },
  { href: "/finance", label: "Finance Metrics", icon: IconDollar, roles: ["admin", "pbd", "costing", "md", "viewer"], section: "Data" },
  { href: "/history", label: "Historical Costing", icon: IconHistory, roles: ["admin", "pbd", "costing", "md", "viewer"], section: "Data" },
  { href: "/like-styles", label: "Like Styles Search", icon: IconHistory, roles: ["admin", "pbd", "costing", "md"], section: "Data" },
  { href: "/qa", label: "Pilot QA", icon: IconCheck, roles: ["admin", "pbd", "costing", "md"], section: "Quality" },
  { href: "/admin", label: "Admin Settings", icon: IconSettings, roles: ["superadmin", "admin"], section: "System" },
  { href: "/admin/audit", label: "Audit Logs", icon: IconAudit, roles: ["superadmin", "admin"], section: "System" },
  { href: "/admin/logs", label: "Error Logs", icon: IconAlert, roles: ["superadmin", "admin"], section: "System" }
];

export function SidebarNav({ role, userName }: { role: string; userName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const visibleNav = nav.filter((item) => item.roles.includes(role as UserRole));
  const sections = [...new Set(visibleNav.map((item) => item.section))];

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <>
      <nav className="sidebar-nav-list" aria-label="Section navigation">
        {sections.map((section) => (
          <div key={section} className="nav-section">
            <div className="nav-section-label">{section}</div>
            {visibleNav.filter((item) => item.section === section).map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : item.href === "/requests"
                    // All Requests highlights the list itself and request detail
                    // pages, but not the Create/Bulk/Import sub-pages (they have
                    // their own items).
                    ? pathname === "/requests" ||
                      (/^\/requests\/[^/]+$/.test(pathname) && !["new", "bulk", "import"].includes(pathname.split("/")[2]))
                    : pathname === item.href || pathname.startsWith(item.href + "/");

              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link${isActive ? " active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className="nav-icon"><Icon size={18} /></span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span className="sidebar-user-name">{userName}</span>
        </div>
        <button
          className="logout-button"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? <><span className="spinner" /> Logging out...</> : "Log out"}
        </button>
      </div>
    </>
  );
}
