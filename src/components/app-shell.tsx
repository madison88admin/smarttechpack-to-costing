import type { ReactNode } from "react";
import { getCurrentRole, getCurrentUserName, getRoleLabel } from "@/lib/auth/roles";
import { SidebarNav } from "@/components/sidebar-nav";
import { NotificationBell } from "@/components/notification-bell";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Avatar } from "@/components/ui/avatar";
import { MobileSidebar } from "@/components/mobile-sidebar";
import { PageTransition } from "@/components/ui/page-transition";

export function AppShell({ children }: { children: ReactNode }) {
  const role = getCurrentRole();
  const userName = getCurrentUserName();

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <MobileSidebar role={role} userName={userName} roleLabel={getRoleLabel(role)} />
      <PageTransition>
        <section className="content" id="main-content" role="main">
          <div className="topbar">
            <div className="topbar-left">
              <span className="brand-mark" aria-hidden="true">TP</span>
              <Breadcrumbs />
            </div>
            <div className="topbar-right">
              <NotificationBell />
              <div className="topbar-user">
                <Avatar name={userName} size="sm" />
                <div className="topbar-user-info">
                  <strong>{userName}</strong>
                  <small>{getRoleLabel(role)}</small>
                </div>
              </div>
            </div>
          </div>
          {children}
        </section>
      </PageTransition>
    </div>
  );
}
