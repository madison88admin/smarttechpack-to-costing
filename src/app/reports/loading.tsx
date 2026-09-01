import { AppShell } from "@/components/app-shell";

export default function ReportsLoading() {
  return (
    <AppShell>
      <div className="report-loading" aria-live="polite" aria-busy="true">
        <div className="report-loading-bar report-loading-title" />
        <div className="report-loading-grid">
          {Array.from({ length: 8 }, (_, index) => <div className="report-loading-card" key={index} />)}
        </div>
        <div className="report-loading-panel" />
      </div>
    </AppShell>
  );
}
