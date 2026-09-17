// Which PostgREST a live driver may write to — decided here, once.
//
// The drivers create and delete real requests, so the database they point at
// must never be an accident of configuration. This app keeps the production VPS
// in NEXT_PUBLIC_SUPABASE_URL, so a driver that inherited that would write test
// rows — one of them approved, with a historical costing row — into the very
// database the operator is QA-ing against, while believing it was "running
// against localhost".
//
// The rule:
//
//   - the default target is the LOCAL PostgREST (127.0.0.1:8000), which cannot
//     be production;
//   - TP_E2E_REST names a different database explicitly;
//   - a target that is not a loopback address is refused unless the operator
//     acknowledges it with TP_E2E_ALLOW_LIVE_DB=1.
//
// One place decides this, so no driver can drift into writing to live rows by
// default — and the acknowledgement is never a per-hazard flag to remember.

export const DEFAULT_REST = "http://127.0.0.1:8000/rest/v1";

/** The environment variable an operator sets to acknowledge a non-local database. */
export const LIVE_OPT_IN_ENV = "TP_E2E_ALLOW_LIVE_DB";

export class UnsafeDriverTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsafeDriverTargetError";
  }
}

function isLoopback(rest) {
  try {
    const { hostname } = new URL(rest);
    return hostname === "localhost" || hostname === "[::1]" || hostname === "::1" || /^127\./.test(hostname);
  } catch {
    return false;
  }
}

/**
 * Resolves the PostgREST base a driver may write to.
 *
 * @param {{ env?: Record<string, string | undefined>, usage?: string }} [options]
 * @returns {{ rest: string, live: boolean }}
 * @throws {UnsafeDriverTargetError} when the target is not local and not opted into
 */
export function resolveRestTarget({ env = process.env, usage = "node scripts/e2e-role-matrix.mjs" } = {}) {
  const rest = (env.TP_E2E_REST ?? "").trim() || DEFAULT_REST;
  if (isLoopback(rest)) return { rest, live: false };
  if (env[LIVE_OPT_IN_ENV] === "1") return { rest, live: true };

  throw new UnsafeDriverTargetError(
    [
      `refusing to write to ${rest}: it is not a loopback database, and these drivers create and delete real requests.`,
      "To run against it on purpose — it will write test rows there — acknowledge it:",
      `    ${LIVE_OPT_IN_ENV}=1 TP_E2E_REST=${rest} ${usage}`,
      `Leave TP_E2E_REST unset to use the local database (${DEFAULT_REST}).`
    ].join("\n")
  );
}
