import { AppShell } from "@/components/app-shell";

// Dashboard loading state — renders instantly on navigation while the server
// finishes the dashboard queries, so a click never sits on the old page with
// no feedback.
export default function DashboardLoading() {
  return (
    <AppShell>
      <div className="dashboard-page" aria-live="polite" aria-busy="true">
        <div className="hero dashboard-hero">
          <div style={{ flex: 1 }}>
            <div className="skeleton-bar w-32 mb-2" />
            <div className="skeleton-bar w-80 mb-3" />
            <div className="skeleton-bar w-full thin" />
          </div>
        </div>
        <div className="grid metrics" style={{ marginTop: 16 }}>
          {Array.from({ length: 4 }, (_, index) => (
            <div className="metric" key={index}>
              <div className="skeleton-bar w-24 mb-3" />
              <div className="skeleton-bar w-16" />
            </div>
          ))}
        </div>
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="skeleton-bar w-48 mb-3" />
          <div className="skeleton-table">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="skeleton-row" key={index}>
                <div className="skeleton-bar w-3q" />
                <div className="skeleton-bar w-24" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
