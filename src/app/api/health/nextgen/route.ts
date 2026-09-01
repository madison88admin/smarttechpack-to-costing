import { NextResponse } from "next/server";
import { getLoginBackoff, resetLoginBackoff } from "@/lib/nextgen/login-backoff";
import {
  getNextGenSessionCookie,
  invalidateNextGenSession,
  isNextGenSessionCached
} from "@/lib/nextgen/session";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 10_000;

type CheckResult = { status: "ok" | "error" | "skipped"; detail?: string };

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// GET /api/health/nextgen
// Reports the NextGen integration's configuration, reachability, and login
// status so integration failures are visible immediately (monitors, uptime
// tools, and the admin diagnostics page). Public like /api/health; no secrets
// are ever returned. Pass ?force=1 to invalidate the cached session first and
// force a fresh login (used by the diagnostics page's "fresh check" action).
// When NextGen is backing off after repeated login failures, the check reports
// that state instead of attempting another login, so monitors do not extend
// the lockout. ?reset-backoff=1 clears the back-off state (admin recovery).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const resetBackoff = url.searchParams.get("reset-backoff") === "1";
  if (force) invalidateNextGenSession();
  if (resetBackoff) resetLoginBackoff();

  const backoff = getLoginBackoff();

  const checks: Record<string, CheckResult> = {};

  // 1. Configuration
  const missing: string[] = [];
  if (!process.env.NEXTGEN_BASE_URL) missing.push("NEXTGEN_BASE_URL");
  if (!process.env.NEXTGEN_USERNAME) missing.push("NEXTGEN_USERNAME");
  if (!process.env.NEXTGEN_PASSWORD) missing.push("NEXTGEN_PASSWORD");
  checks.configuration = missing.length
    ? { status: "error", detail: `Missing: ${missing.join(", ")}` }
    : { status: "ok" };

  const baseUrl = process.env.NEXTGEN_BASE_URL;

  // 2. Reachability — any HTTP response means the host is up; a thrown fetch
  // (DNS/TLS/timeout) means it is not.
  if (!baseUrl) {
    checks.reachable = { status: "skipped" };
  } else {
    try {
      await fetchWithTimeout(`${baseUrl}/Account/Login`, {
        method: "GET",
        cache: "no-store",
        redirect: "manual"
      });
      checks.reachable = { status: "ok" };
    } catch (error) {
      checks.reachable = { status: "error", detail: error instanceof Error ? error.message : "unreachable" };
    }
  }

  // 3. Login — obtain (or reuse) the NextGen session. The source is reported
  // so readers know whether the result is a fresh login or a recent cache hit.
  if (checks.configuration.status !== "ok") {
    checks.login = { status: "skipped" };
  } else if (backoff.active) {
    // Backing off after repeated failures: do NOT attempt another login.
    // Report the window so monitors see why the integration is down.
    checks.login = {
      status: "error",
      detail: `Backing off after ${backoff.failures} consecutive login failures; next attempt in ~${backoff.retryAfterSeconds}s (${backoff.blockedUntil})`
    };
  } else {
    const wasCached = isNextGenSessionCached();
    try {
      await getNextGenSessionCookie();
      checks.login = {
        status: "ok",
        detail: wasCached ? "session reused from cache" : "fresh login succeeded"
      };
    } catch (error) {
      // The failure was already counted by session.ts; do not record twice.
      checks.login = {
        status: "error",
        detail: error instanceof Error ? error.message : "login failed"
      };
    }
  }

  const ok = Object.values(checks).every((check) => check.status === "ok");

  return NextResponse.json(
    {
      ok,
      checks,
      force,
      resetBackoff,
      backoff,
      timestamp: new Date().toISOString()
    },
    { status: ok ? 200 : 503 }
  );
}
