// Shared lifecycle guard for the live driver scripts.
//
// The drivers create real requests in the live database, so a run that dies
// part-way leaves those rows behind forever — a closed terminal, a restart, an
// exception, or a `| head` that closes stdout have all done exactly that, and
// the leftovers then show up in Like Styles, reporting and the machine averages.
//
// Three guarantees, all marker-based rather than memory-based, because a run
// that dies early cannot be trusted to remember what it created:
//
//   1. REFUSE TO START on leftovers. Before touching anything, the driver asks
//      whether any request still carries its marker. If one does, it prints
//      them and exits non-zero instead of stacking a second set on top.
//   2. ALWAYS CLEAN UP. Every exit path — normal finish, thrown error,
//      unhandled rejection, Ctrl+C, SIGTERM, a closed stdout (EPIPE), even the
//      driver's own `process.exit` — sweeps the marker and removes what the run
//      created. The sweep verifies itself and retries while rows remain.
//   3. NEVER ABANDON A CLEANUP HALF-DONE. Exiting is owned here: a driver's
//      own `process.exit` is deferred until the sweep finishes, and the process
//      is only torn down once fetch's handles have settled (a bare exit mid-close
//      aborts Windows libuv with exit code 127).
//
// Markers live in `notes`, set at creation time, so the sweep finds rows even
// when the run never got as far as tracking their ids.
//
// `TP_E2E_LOG=<path>` mirrors every message to a file: after the interrupt that
// matters most — a closed stdout — the operator can still read what happened.

import { appendFileSync } from "node:fs";

// The real exit, captured before the guard takes `process.exit` over.
const realExit = process.exit.bind(process);

/**
 * Ends a script without the Windows abort.
 *
 * A bare `process.exit()` while fetch's undici handles are still closing trips
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in libuv, and the
 * process then dies with exit code 127 — a clean finish reported as a phantom
 * failure. Waiting for the handles to settle before exiting avoids it.
 *
 * The timer is deliberately *ref'd*: an unref'd one lets the loop drain first,
 * and Node then exits 13 (unsettled top-level await) before it ever fires.
 *
 * Resolves never: callers `await` it so nothing after the exit point runs.
 */
export function exitCleanly(code = 0) {
  process.exitCode = code;
  setTimeout(() => realExit(code), 300);
  return new Promise(() => {});
}

const TERMINAL_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"];
const CLEANUP_DEADLINE_MS = Number(process.env.TP_E2E_CLEANUP_DEADLINE_MS ?? 20000);

/** Rows the sweep will never delete on its own, whatever the marker says. */
const PROTECTED_STATUSES = ["approved"];

// `TP_E2E_LOG=<path>` mirrors guard messages to a file. After an interrupt this
// is the only place they survive: the interrupt that matters most — a closed
// stdout — is exactly the one that eats them.
const LOG_FILE = process.env.TP_E2E_LOG;

function log(message) {
  const line = `[guard] ${message}\n`;
  if (LOG_FILE) {
    try {
      appendFileSync(LOG_FILE, line);
    } catch {
      /* best effort: a broken log path must not break cleanup */
    }
  }
  // Never throw on a closed pipe: that is itself an interrupt we must survive.
  try {
    process.stdout.write(line);
  } catch {
    /* stdout is gone; cleanup still has to run */
  }
}

/**
 * Starts a guarded driver run.
 *
 * @param {object} options
 * @param {string} options.name      driver name, for messages
 * @param {string} options.marker    token written into created rows' notes
 * @param {string} options.rest      PostgREST base, e.g. http://host:8000/rest/v1
 * @param {Record<string,string>} options.headers  service-role headers (incl. Accept-Profile)
 * @returns {Promise<{trackRequest: Function, track: Function, finish: Function, leftovers: Function}>}
 */
export async function beginDriverRun({ name, marker, rest, headers }) {
  if (!name || !marker || !rest || !headers) {
    throw new Error("beginDriverRun requires name, marker, rest and headers");
  }

  const cleanups = [];
  let finished = false;
  let cleaning = false;
  let exiting = false;

  const query = (filter) => `${rest}/costing_requests?select=id,request_number,status,factory_name,created_at&${filter}`;

  async function findMarked() {
    const response = await fetch(query(`notes=ilike.*${encodeURIComponent(marker)}*`), { headers });
    if (!response.ok) throw new Error(`could not scan for ${marker} rows: HTTP ${response.status}`);
    return response.json();
  }

  function describe(rows) {
    return rows
      .map((row) => `    ${row.request_number ?? row.id} [${row.status}] ${row.factory_name ?? "—"} (created ${row.created_at ?? "?"})`)
      .join("\n");
  }

  async function deleteRequest(row) {
    const response = await fetch(`${rest}/costing_requests?id=eq.${row.id}`, { method: "DELETE", headers });
    if (!response.ok) throw new Error(`DELETE ${row.request_number ?? row.id} → HTTP ${response.status}`);
  }

  async function sweep() {
    const rows = await findMarked();
    if (!rows.length) return;
    for (const row of rows) {
      // An approved request owns a historical costing row, and deleting it
      // cascades that away with it — the exact way the cost library lost a row
      // before. Delete it, but say so out loud so it is never silent.
      const cascadesHistory = PROTECTED_STATUSES.includes(row.status);
      await deleteRequest(row);
      log(`removed ${row.request_number ?? row.id}${cascadesHistory ? ` (was ${row.status} — its historical costing row cascaded with it)` : ""}`);
    }
  }

  async function runCleanups(reason) {
    if (cleaning) return;
    cleaning = true;
    log(`cleaning up (${reason})`);

    // The marker sweep is authoritative; the tracked cleanups restore things
    // the marker cannot describe (NextGen snapshots, uploaded files).
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        log(`a tracked cleanup failed: ${error?.message ?? error}`);
      }
    }

    // Sweep, verify, and sweep again if the run was still creating rows while
    // the first sweep ran — a driver only notices an interrupt between steps.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await sweep();
      } catch (error) {
        log(`marker sweep failed: ${error?.message ?? error}`);
      }
      try {
        if ((await findMarked()).length === 0) break;
      } catch {
        break;
      }
    }

    try {
      const remaining = await findMarked();
      if (remaining.length) {
        log(`WARNING: ${remaining.length} row(s) still carry ${marker} — delete them manually:`);
        log(describe(remaining));
      } else {
        log(`clean — no ${marker} rows remain`);
      }
    } catch {
      log(`could not verify the sweep; re-check ${marker} rows manually`);
    }
  }

  /**
   * Halts before anything is created — the refusal path. The promise it returns
   * never settles, so the driver's top-level `await` stops here.
   */
  function halt(code) {
    return exitCleanly(code);
  }

  function exitWith(code, reason) {
    if (exiting) return; // signals repeat; the cleanup runs once
    exiting = true;

    // The deadline is a safety net for a hung network, not a race with the
    // cleanup. It used to be a 100ms grace-exit, which a passing test suite
    // never caught because the stub PostgREST answers instantly — against the
    // real database the sweep needs several round-trips, so the process exited
    // mid-flight and left the very rows this guard exists to remove.
    const deadline = setTimeout(() => {
      log(`cleanup exceeded ${CLEANUP_DEADLINE_MS}ms; exiting anyway`);
      void exitCleanly(code);
    }, CLEANUP_DEADLINE_MS);

    runCleanups(reason)
      .catch((error) => log(`cleanup failed outright: ${error?.message ?? error}`))
      .finally(() => {
        clearTimeout(deadline);
        // exitCleanly carries the settle delay, so the loop is never torn down
        // while a fetch handle is closing (the Windows UV_HANDLE_CLOSING abort).
        void exitCleanly(code);
      });
  }

  // ── Preflight: never stack a run on a previous run's leftovers ─────────────
  const leftoverRows = await findMarked();
  if (leftoverRows.length) {
    if (process.env.TP_E2E_ALLOW_LEFTOVERS === "1") {
      log(`WARNING: ${leftoverRows.length} leftover ${marker} row(s) present — continuing because TP_E2E_ALLOW_LEFTOVERS=1`);
      log(describe(leftoverRows));
    } else {
      log(`refusing to run ${name}: ${leftoverRows.length} row(s) from a previous run still exist`);
      log(describe(leftoverRows));
      log("clean them up first, then re-run:");
      log(`    node scripts/cleanup-test-requests.mjs --marker=${marker} --apply`);
      log("(set TP_E2E_ALLOW_LEFTOVERS=1 to run anyway — not recommended)");
      return halt(2);
    }
  }

  // ── Interrupt handling: clean up, then exit ───────────────────────────────
  for (const signal of TERMINAL_SIGNALS) {
    try {
      process.on(signal, () => exitWith(130, `${signal} received`));
    } catch {
      /* signal not supported on this platform */
    }
  }
  process.on("uncaughtException", (error) => {
    log(`uncaught exception: ${error?.message ?? error}`);
    exitWith(1, "uncaught exception");
  });
  process.on("unhandledRejection", (reason) => {
    log(`unhandled rejection: ${reason?.message ?? reason}`);
    exitWith(1, "unhandled rejection");
  });
  // `driver | head` closes stdout and Node raises EPIPE on the next write —
  // that is an interrupt like any other, not a reason to abandon the rows.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error) => {
      if (error?.code === "EPIPE") exitWith(0, "stdout closed (EPIPE)");
    });
  }

  // The driver's own exits must go through the cleanup too. They call a bare
  // `process.exit(1)` on failure, and doing that while the sweep was in flight
  // abandoned exactly the rows this guard exists to remove — observed live: the
  // guard logged "cleaning up (stdout closed (EPIPE))" and the process died
  // mid-sweep, leaving a request behind in for_pbd_review.
  process.exit = (code) => exitWith(typeof code === "number" ? code : 0, "process.exit()");

  log(`${name} starting (marker: ${marker})`);

  return {
    /** Register a cleanup to run on every exit path (snapshots, files, …). */
    track(cleanup) {
      cleanups.push(cleanup);
    },
    /** Convenience: delete this request on exit even if the sweep misses it. */
    trackRequest(requestId) {
      if (requestId) cleanups.push(async () => {
        await fetch(`${rest}/costing_requests?id=eq.${requestId}`, { method: "DELETE", headers });
      });
    },
    /** Success path: clean up and verify nothing was left behind. */
    async finish() {
      if (finished) return;
      finished = true;
      await runCleanups("run finished");
    },
    /** Current leftovers, for assertions and diagnostics. */
    leftovers: findMarked
  };
}
