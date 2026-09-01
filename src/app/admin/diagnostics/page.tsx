import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { NextGenHealthPanel } from "@/components/nextgen-health-panel";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";

export default async function AdminDiagnosticsPage() {
  const role = getCurrentRole();

  if (!canAccessAdmin(role)) {
    return (
      <AppShell>
        <section className="panel">
          <div className="empty-state">
            <strong>Access Denied</strong>
            <p>Your role ({role}) does not have access to system diagnostics.</p>
          </div>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="hero">
        <div>
          <p className="eyebrow">System Diagnostics</p>
          <h1>Integration Health</h1>
          <p className="hero-copy">
            Live status of the NextGen integration — configuration, reachability, and login — so
            integration failures are visible immediately instead of surfacing as missing data.
          </p>
        </div>
        <div className="hero-actions">
          <Link className="button secondary" href="/admin">
            Back to Admin
          </Link>
        </div>
      </div>

      <NextGenHealthPanel />

      <section className="panel">
        <h2>Public health endpoints</h2>
        <ul className="list compact-list">
          <li><code>/api/health</code> — app + database status (used by uptime monitors).</li>
          <li><code>/api/health/nextgen</code> — NextGen configuration, reachability, and login; add <code>?force=1</code> for a fresh login check.</li>
        </ul>
      </section>
    </AppShell>
  );
}
