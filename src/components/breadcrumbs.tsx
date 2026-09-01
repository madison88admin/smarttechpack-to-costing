"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChevronRight, IconHome } from "@/components/ui/icons";

const routeLabels: Record<string, string> = {
  "": "Dashboard",
  admin: "Admin",
  audit: "Audit Logs",
  logs: "Error Logs",
  factory: "Factory",
  finance: "Finance Metrics",
  history: "History",
  login: "Login",
  "material-library": "Material Library",
  production: "Production",
  qa: "Pilot QA",
  requests: "Requests",
  new: "New Request",
  bulk: "Bulk Import",
  "cbd-diff": "CBD Diff"
};

interface Crumb {
  label: string;
  href?: string;
}

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return [{ label: "Dashboard" }];
  }

  const crumbs: Crumb[] = [{ label: "Dashboard", href: "/" }];
  let path = "";

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    path += `/${seg}`;
    const isLast = i === segments.length - 1;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg);
    const label = routeLabels[seg] ?? (isUuid ? `${seg.slice(0, 8)}…` : seg);
    crumbs.push({
      label,
      href: isLast ? undefined : path
    });
  }

  return crumbs;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  if (!pathname || pathname === "/") return null;

  const crumbs = buildCrumbs(pathname);

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol className="breadcrumb-list">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={i} className="breadcrumb-item">
              {i === 0 ? (
                <Link href="/" className="breadcrumb-link breadcrumb-home" aria-label="Dashboard">
                  <IconHome size={14} />
                </Link>
              ) : crumb.href && !isLast ? (
                <Link href={crumb.href} className="breadcrumb-link">
                  {crumb.label}
                </Link>
              ) : (
                <span className="breadcrumb-current" aria-current="page">
                  {crumb.label}
                </span>
              )}
              {!isLast ? <IconChevronRight size={13} className="breadcrumb-sep" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
