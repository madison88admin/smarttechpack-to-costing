"use client";

import { useCallback, useEffect, useState } from "react";
import { IconCheckCircle, IconXCircle, IconAlertCircle, IconClock } from "@/components/ui/icons";

type CheckResult = { status: "ok" | "error" | "skipped"; detail?: string };
type HealthResponse = {
  ok: boolean;
  checks: { configuration: CheckResult; reachable: CheckResult; login: CheckResult };
  force: boolean;
  timestamp: string;
};

const CHECK_LABELS: Record<keyof HealthResponse["checks"], string> = {
  configuration: "Configuration",
  reachable: "Reachability",
  login: "NextGen Login"
};

const STATUS_LABELS: Record<CheckResult["status"], string> = {
  ok: "OK",
  error: "ERROR",
  skipped: "SKIPPED"
};

function StatusBadge({ status, loading }: { status: CheckResult["status"] | "loading"; loading?: boolean }) {
  const cls = status === "ok" ? "green" : status === "error" ? "red" : status === "loading" ? "blue" : "neutral";
  return (
    <span className={`status ${cls}`}>
      <span className="status-dot" />
      <span className="status-label">{loading ? "CHECKING…" : STATUS_LABELS[status as CheckResult["status"]]}</span>
    </span>
  );
}

export function NextGenHealthPanel() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runCheck = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/health/nextgen${force ? "?force=1" : ""}`, { cache: "no-store" });
      const body = await res.json();
      if (!body.checks) throw new Error(body.error ?? `Health check failed (${res.status})`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Health check failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runCheck(false);
  }, [runCheck]);

  const checks = data?.checks;

  return (
    <div className="split">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">NextGen integration</p>
            <h2>Integration Status</h2>
          </div>
          {data ? (
            <span className={`status ${data.ok ? "green" : "red"}`}>
              <span className="status-dot" />
              <span className="status-label">{data.ok ? "ALL SYSTEMS OK" : "ISSUE DETECTED"}</span>
            </span>
          ) : null}
        </div>

        {error ? <p className="notice">Health check failed: {error}</p> : null}
        {!data && !error ? <p className="notice">Running check…</p> : null}

        {checks ? (
          <ul className="list">
            {Object.entries(checks).map(([key, check]) => (
              <li key={key} className="health-row">
                <div>
                  <strong>{CHECK_LABELS[key as keyof HealthResponse["checks"]]}</strong>
                  {check.detail ? <p className="muted">{check.detail}</p> : null}
                </div>
                <StatusBadge status={loading ? "loading" : check.status} loading={loading} />
              </li>
            ))}
            <li className="health-row">
              <div>
                <strong>Last checked</strong>
                <p className="muted">
                  <IconClock size={13} /> {new Date(data!.timestamp).toLocaleString()}
                  {data!.force ? " (fresh login)" : ""}
                </p>
              </div>
            </li>
          </ul>
        ) : null}

        <div className="form-actions">
          <button className="button" type="button" onClick={() => runCheck(false)} disabled={loading}>
            <IconCheckCircle size={14} /> Refresh
          </button>
          <button className="button secondary" type="button" onClick={() => runCheck(true)} disabled={loading}>
            <IconAlertCircle size={14} /> Run fresh login check
          </button>
        </div>
      </section>

      <aside className="grid">
        <section className="panel">
          <h2>What each check means</h2>
          <ul className="list compact-list">
            <li><strong>Configuration</strong> — the NEXTGEN_BASE_URL, NEXTGEN_USERNAME, and NEXTGEN_PASSWORD environment variables are all set.</li>
            <li><strong>Reachability</strong> — the NextGen host answers HTTP requests.</li>
            <li><strong>NextGen Login</strong> — the app can obtain a NextGen session with the configured credentials. A failure here means product search, BOM, PO/MPO data, and product images will all be unavailable.</li>
          </ul>
          <div className="form-actions">
            <button className="button secondary" type="button" onClick={() => runCheck(true)} disabled={loading}>
              <IconXCircle size={14} /> Test login now
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}
