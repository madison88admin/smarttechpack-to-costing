/**
 * Consecutive-login-failure back-off for the NextGen integration.
 *
 * When NextGen rejects credentials repeatedly (wrong password, or an account
 * locked by a flood of bad attempts), every fresh login attempt risks
 * extending the lockout. This module tracks consecutive failures and refuses
 * to attempt another login for an exponentially growing window, so monitors
 * and the app stop hammering a locked account.
 *
 * Pure/stateful by design: all functions accept an injectable `now` (ms epoch)
 * so the state machine is unit-testable without touching the clock.
 */

export type LoginBackoffSnapshot = {
  /** True while a fresh login attempt would be refused. */
  active: boolean;
  /** Consecutive failures recorded so far. */
  failures: number;
  /** Seconds until the next login attempt is allowed (0 when not active). */
  retryAfterSeconds: number;
  /** ISO timestamp when the window ends (null when not active). */
  blockedUntil: string | null;
};

// Doubling windows: 30s, 1m, 2m, 4m, 8m, capped at 15m.
const BACKOFF_STEPS_MS = [
  30_000,
  60_000,
  120_000,
  240_000,
  480_000,
  900_000
] as const;

const MAX_FAILURES_BEFORE_BACKOFF = 2;

let failures = 0;
let blockedUntilMs = 0;

export function backoffStepMs(failureCount: number): number {
  if (failureCount <= 0) return 0;
  const index = Math.min(failureCount - 1, BACKOFF_STEPS_MS.length - 1);
  return BACKOFF_STEPS_MS[index];
}

export function isLoginBackedOff(now = Date.now()): boolean {
  return failures >= MAX_FAILURES_BEFORE_BACKOFF && blockedUntilMs > now;
}

export function recordLoginFailure(now = Date.now()): number {
  failures += 1;
  blockedUntilMs = now + backoffStepMs(failures);
  return failures;
}

export function recordLoginSuccess(): void {
  failures = 0;
  blockedUntilMs = 0;
}

export function resetLoginBackoff(): void {
  failures = 0;
  blockedUntilMs = 0;
}

export function getLoginBackoff(now = Date.now()): LoginBackoffSnapshot {
  const active = isLoginBackedOff(now);
  const remaining = active ? blockedUntilMs - now : 0;
  return {
    active,
    failures,
    retryAfterSeconds: active ? Math.ceil(remaining / 1000) : 0,
    blockedUntil: active ? new Date(blockedUntilMs).toISOString() : null
  };
}

export function getLoginBackoffFailures(): number {
  return failures;
}
