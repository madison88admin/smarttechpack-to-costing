import { existsSync, readFileSync } from "node:fs";

// A handful of suites have a live service as their *subject* (curated benchmark
// persistence writes real rows). Those are opt-in; everything else in tests/ must
// stay offline, because a suite that reaches production turns somebody else's
// uptime — and their data — into our colour.
//
// This is deliberately the same switch the live drivers already honour, so there
// is exactly one way to say "yes, run this against the real thing".

export const LIVE_OPT_IN_ENV = "TP_E2E_ALLOW_LIVE_DB";

export function liveUpstreamEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LIVE_OPT_IN_ENV] === "1";
}

export function liveSkipNote(): string {
  return `live upstream test — set ${LIVE_OPT_IN_ENV}=1 to run it`;
}

/**
 * Loads .env.local when it is present. CI has no such file, and the previous
 * unconditional read threw at import time, which meant the suite could never run
 * in CI at all.
 */
export function loadLocalEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
}
