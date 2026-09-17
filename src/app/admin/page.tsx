import { AppShell } from "@/components/app-shell";
import { AdminChecklistManager } from "@/components/admin-checklist-manager";
import { AdminNotificationQueue } from "@/components/admin-notification-queue";
import { AdminRecipientManager } from "@/components/admin-recipient-manager";
import { CurrencyRateManager } from "@/components/currency-rate-manager";
import { AdminSettingsForm } from "@/components/admin-settings-form";
import { AdminUserManager } from "@/components/admin-user-manager";
import { AdminFactoryAssignmentManager } from "@/components/admin-factory-assignment-manager";
import { EscalationTrigger } from "@/components/escalation-trigger";
import { HistoricalImportTool } from "@/components/historical-import-tool";
import { NextGenHistoricalSyncTool } from "@/components/nextgen-historical-sync";
import { NextGenBomCheck } from "@/components/nextgen-bom-check";
import { getWorkflowSettings, defaultWorkflowSettings } from "@/lib/admin/settings";
import { canAccessAdmin, canManageUsers, getCurrentRole } from "@/lib/auth/roles";
import { tryListUserProfiles } from "@/lib/auth/users";
import { listChecklistItems } from "@/lib/costing/checklist";
import { listFactoryAssignments } from "@/lib/admin/assignments";
import Link from "next/link";

export default async function AdminPage() {
  const role = getCurrentRole();

  if (!canAccessAdmin(role)) {
    return (
      <AppShell>
        <section className="panel">
          <div className="empty-state">
            <strong>Access Denied</strong>
            <p>Your role ({role}) does not have access to admin settings.</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const [{ data: users, error }, checklistItems, settings, assignments] = await Promise.all([
    tryListUserProfiles(),
    listChecklistItems().catch(() => []),
    getWorkflowSettings().catch(() => defaultWorkflowSettings),
    listFactoryAssignments().catch((assignmentError) => ({ users: [], requests: [], error: assignmentError instanceof Error ? assignmentError.message : "Unable to load assignments" }))
  ]);

  return (
    <AppShell>
      <div className="hero">
        <div>
          <p className="eyebrow">Administration{canManageUsers(role) ? " — Super Admin" : ""}</p>
          <h1>Workflow Settings</h1>
          <p className="hero-copy">
            Pilot configuration view for users, roles, validation checklist, reminder rules, and benchmark thresholds.
          </p>
        </div>
      </div>

      <div className="split">
        <div className="grid">
          <section className="panel">
            <h2>User Management{canManageUsers(role) ? " (Full Access)" : ""}</h2>
            {error ? <p className="notice">Unable to load users: {error}</p> : null}
            <AdminUserManager users={users ?? []} />
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Factory access</p>
                <h2>Assign Factory Users</h2>
              </div>
            </div>
            {"error" in assignments && assignments.error ? <p className="notice">Unable to load assignments: {assignments.error}</p> : null}
            <AdminFactoryAssignmentManager users={assignments.users} requests={assignments.requests} />
          </section>

          <section className="panel">
            <h2>Authentication Status</h2>
            <ul className="list compact-list">
              <li>User-table login enabled</li>
              <li>Password hash support enabled for new users</li>
              <li>Pilot fallback remains available by role for seeded users</li>
              <li>Next phase: move to Supabase Auth or company SSO</li>
            </ul>
          </section>

          <section className="panel">
            <h2>Validation Checklist</h2>
            <AdminChecklistManager items={checklistItems} />
          </section>

          <section className="panel">
            <h2>Currency Exchange Rates</h2>
            <p className="eyebrow">Configure exchange rates for multi-currency costing comparison</p>
            <CurrencyRateManager />
          </section>

          <section className="panel">
            <h2>Historical Data Import</h2>
            <p className="eyebrow">Import existing Data Bank records to populate benchmarks immediately</p>
            <HistoricalImportTool />
          </section>

          <section className="panel">
            <h2>NextGen Historical Sync</h2>
            <p className="eyebrow">Pull Dropped/archived styles and default costing from NextGen into the historical archive</p>
            <NextGenHistoricalSyncTool />
          </section>

          <section className="panel">
            <h2>NextGen BOM Version Watch</h2>
            <p className="eyebrow">Detect BOM changes in NextGen per style and alert the costing team through the change-alert flow</p>
            <NextGenBomCheck />
          </section>
        </div>

        <aside className="grid">
          <section className="panel">
            <h2>Editable Workflow Settings</h2>
            <AdminSettingsForm settings={settings} />
          </section>

          <section className="panel">
            <h2>Notification Rules</h2>
            <ul className="list compact-list">
              <li>Send to Factory - notify factory owner</li>
              <li>CBD Submitted - notify PBD/Costing</li>
              <li>Needs Clarification - notify factory</li>
              <li>SLA Reminder - sent 1 day before SLA breach</li>
              <li>Escalation - sent to manager after SLA breach + 4 days</li>
            </ul>
            <div className="form-actions">
              <EscalationTrigger />
            </div>
          </section>

          <section className="panel">
            <h2>Notification Recipients</h2>
            <p className="eyebrow">Configure who receives notifications for each workflow event</p>
            <AdminRecipientManager />
          </section>

          <section className="panel">
            <h2>Notification Queue</h2>
            <p className="eyebrow">Delivery health for queued email and Teams notifications</p>
            <AdminNotificationQueue />
          </section>

          <section className="panel">
            <h2>Production Controls</h2>
            <ul className="list compact-list">
              <li>HTTPS enabled</li>
              <li>Backup script added under deploy folder</li>
              <li>Health endpoints available at /api/health and /api/health/nextgen</li>
              <li>Error log table added for app-side logging</li>
              <li>Node 22 deployment target prepared</li>
            </ul>
            <div className="form-actions">
              <Link className="button secondary" href="/admin/logs">Open Error Logs</Link>
              <Link className="button secondary" href="/admin/audit">Open Audit Viewer</Link>
              <Link className="button secondary" href="/admin/diagnostics">Open Diagnostics</Link>
            </div>
          </section>

          {canManageUsers(role) ? (
            <section className="panel">
              <h2>System Maintenance (Super Admin)</h2>
              <p className="eyebrow">Full system administration — user roles, data sync, escalations</p>
              <ul className="list compact-list">
                <li>Manage all user accounts and assign roles (including Super Admin)</li>
                <li>Trigger notification escalations manually</li>
                <li>Import historical costing data for benchmarks</li>
                <li>Sync material library from NextGen</li>
                <li>Configure currency exchange rates</li>
                <li>View audit trail and error logs</li>
                <li>Manage validation checklist and notification recipients</li>
              </ul>
              <div className="form-actions">
                <Link className="button" href="/admin/audit">Audit Trail</Link>
                <Link className="button secondary" href="/admin/logs">Error Logs</Link>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </AppShell>
  );
}
