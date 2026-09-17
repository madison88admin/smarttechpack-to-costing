// Shared lifecycle guard for the live driver scripts.
//
// The drivers create real requests in the live database, so a run that dies
// part-way leaves those rows behind forever — a closed terminal, a restart, an
// exception, or a `| head` that closes stdout have all done exactly that, and
// the leftovers then show up in Like Styles, reporting and the machine averages.
//
// Five guarantees, all of them owned here rather than re-implemented per driver:
//
//   1. REFUSE TO START on leftovers. Before touching anything, the driver asks
//      whether any request still carries its marker. If one does, it prints
//      them and exits non-zero instead of stacking a second set on top.
//   2. ALWAYS CLEAN UP. Every exit path — normal finish, thrown error,
//      unhandled rejection, Ctrl+C, SIGTERM, a closed stdout (EPIPE), even the
//      driver's own `process.exit` — sweeps and removes what the run created.
//   3. NEVER ABANDON A CLEANUP HALF-DONE. Exiting is owned here: a driver's
//      own `process.exit` is deferred until the sweep finishes, and the process
//      is only torn down once fetch's handles have settled (a bare exit mid-close
//      aborts Windows libuv with exit code 127).
//   4. ONE RUN PER DATABASE AT A TIME. Two runs must not interleave: the second
//      refuses, because the lock file is created exclusively. This is what
//      stops a near-simultaneous start from racing a live run.
//   5. DELETE ONLY WHAT THIS RUN CAN PROVE IT CREATED. A marker alone is not
//      ownership — it also matches a previous run's leftovers and a colleague's
//      in-flight rows. Every row carries this run's id, the sweep removes
//      exactly those, and an approved (protected) request is never deleted at
//      all: it owns a historical costing row, and that cascade is how the cost
//      library lost a row. Whatever is left is reported, named, pointed at
//      scripts/cleanup-test-requests.mjs, and the run exits non-zero.
//
// Markers live in `notes`, set at creation time, so the sweep finds rows even
// when the run never got as far as tracking their ids.
//
// `TP_E2E_LOG=<path>` mirrors every message to a file: after the interrupt that
// matters most — a closed stdout — the operator can still read what happened.

import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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

/** Rows the sweep will never delete, whatever the marker says. */
const PROTECTED_STATUSES = ["approved"];

/** Two drivers writing to one database share a lock, so they cannot interleave. */
const LOCK_DIR = process.env.TP_E2E_LOCK_DIR ?? "tmp";
/** A lock whose run outlived this is stale — the process is gone. */
const LOCK_TTL_MS = Number(process.env.TP_E2E_LOCK_TTL_MS ?? 6 * 60 * 60 * 1000);

/** `TP_E2E_LOG=<path>` mirrors guard messages to a file. After an interrupt this
 * is the only place they survive: the interrupt that matters most — a closed
 * stdout — is exactly the one that eats them. */
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

/** The lock file for one database (one PostgREST host:port, one lock). */
export function lockPathFor(rest, dir = LOCK_DIR) {
  let host = "unknown";
  try {
    host = new URL(rest).host;
  } catch {
    /* an unparseable target still gets its own lock */
  }
  return join(dir, `${host.replace(/[^a-z0-9]+/gi, "-")}.driver.lock`);
}

function readLock(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return error?.code === "EPERM";
  }
}

/**
 * Creates the lock exclusively — `wx` fails when someone else holds it, so two
 * simultaneous starts cannot both win. A lock whose process is gone, or whose
 * run outlived LOCK_TTL_MS, is taken over with a note.
 *
 * @returns {{ ok: true } | { ok: false, held: object | null }}
 */
function acquireLock(path, name, runId) {
  const mine = { runId, name, pid: process.pid, startedAt: new Date().toISOString() };
  mkdirSync(dirname(path), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify(mine, null, 2)}\n`, { flag: "wx" });
      return { ok: true };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const held = readLock(path);
      const stale = !held || !isAlive(held.pid) || Date.now() - Date.parse(held.startedAt ?? "") > LOCK_TTL_MS;
      if (!stale) return { ok: false, held };
      log(`taking over the lock at ${path} — run ${held?.runId ?? "unknown"} (pid ${held?.pid ?? "?"}) is gone or past its ${Math.round(LOCK_TTL_MS / 60000)}min`);
      try {
        unlinkSync(path);
      } catch {
        /* lost the race; the next attempt reads whoever won it */
      }
    }
  }
  return { ok: false, held: readLock(path) };
}

function releaseLock(path, runId) {
  if (readLock(path)?.runId !== runId) return; // never remove a lock that is not ours
  try {
    unlinkSync(path);
  } catch {
    /* already gone, or held open by another process — the TTL covers that */
  }
}

/**
 * Starts a guarded driver run.
 *
 * @param {object} options
 * @param {string} options.name      driver name, for messages
 * @param {string} options.marker    token written into created rows' notes
 * @param {string} options.rest      PostgREST base, from resolveRestTarget()
 * @param {Record<string,string>} options.headers  service-role headers (incl. Accept-Profile)
 * @returns {Promise<{id: string, trackRequest: Function, track: Function, finish: Function, leftovers: Function}>}
 */
export async function beginDriverRun({ name, marker, rest, headers }) {
  if (!name || !marker || !rest || !headers) {
    throw new Error("beginDriverRun requires name, marker, rest and headers");
  }

  // This run's identity. The driver embeds it in every row it creates, which is
  // what lets the sweep below tell this run's rows from anyone else's.
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

  const cleanups = [];
  const lockPath = lockPathFor(rest);
  let finished = false;
  let cleaning = false;
  let exiting = false;
  let blocked = false;

  const query = (filter) => `${rest}/costing_requests?select=id,request_number,status,factory_name,created_at,notes&${filter}`;

  /** Every row carrying the marker, whoever created it. */
  async function findMarked() {
    const response = await fetch(query(`notes=ilike.*${encodeURIComponent(marker)}*`), { headers });
    if (!response.ok) throw new Error(`could not scan for ${marker} rows: HTTP ${response.status}`);
    return response.json();
  }

  const isOurs = (row) => String(row.notes ?? "").includes(runId);
  const isProtected = (row) => PROTECTED_STATUSES.includes(row.status);

  function describe(rows) {
    return rows
      .map((row) => `    ${row.request_number ?? row.id} [${row.status}] ${row.factory_name ?? "—"} (created ${row.created_at ?? "?"})`)
      .join("\n");
  }

  async function deleteRequest(row) {
    const response = await fetch(`${rest}/costing_requests?id=eq.${row.id}`, { method: "DELETE", headers });
    if (!response.ok) throw new Error(`DELETE ${row.request_number ?? row.id} → HTTP ${response.status}`);
  }

  /**
   * Removes this run's own rows. A row this run cannot prove it created is left
   * where it is, and a protected row is never deleted by the sweep — it owns a
   * historical costing row, and the cascade that takes is exactly how the cost
   * library lost a row before.
   */
  async function sweep() {
    const ours = (await findMarked()).filter(isOurs);
    for (const row of ours) {
      if (isProtected(row)) {
        log(`LEFT IN PLACE: ${row.request_number ?? row.id} [${row.status}] — its historical costing row cascades with it`);
        continue;
      }
      try {
        await deleteRequest(row);
        log(`removed ${row.request_number ?? row.id}`);
      } catch (error) {
        log(`could not remove ${row.request_number ?? row.id}: ${error?.message ?? error}`);
      }
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
        if (!(await findMarked()).some(isOurs)) break;
      } catch {
        break;
      }
    }

    // Report exactly what is left, and never call a run clean when something
    // is: our own rows would be a leak, someone else's are not ours to delete,
    // and an approved row has to be removed deliberately.
    try {
      const remaining = await findMarked();
      const ours = remaining.filter(isOurs);
      const foreign = remaining.filter((row) => !isOurs(row));
      const approved = remaining.filter(isProtected);

      if (approved.length) {
        blocked = true;
        log(`WARNING: ${approved.length} approved row(s) left in place — a driver never deletes an approved request, whose historical costing row would cascade with it:`);
        log(describe(approved));
      }
      if (ours.length) {
        blocked = true;
        log(`WARNING: ${ours.length} row(s) this run created are still there:`);
        log(describe(ours));
      }
      if (foreign.length) {
        if (process.env.TP_E2E_ALLOW_LEFTOVERS !== "1") blocked = true;
        log(`${foreign.length} row(s) carry ${marker} but were not created by this run — left untouched:`);
        log(describe(foreign));
      }
      if (!remaining.length) log(`clean — no ${marker} rows remain`);
      else log(`remove anything left behind deliberately: node scripts/cleanup-test-requests.mjs --marker=${marker} --apply`);
      if (blocked) log(`FAILING this run: the rows above are still in the database`);
    } catch {
      blocked = true;
      log(`could not verify the sweep; re-check ${marker} rows manually: node scripts/cleanup-test-requests.mjs --marker=${marker} --apply`);
    }

    if (blocked) process.exitCode = 1;
    releaseLock(lockPath, runId);
  }

  function exitWith(code, reason) {
    if (exiting) return; // signals repeat; the cleanup runs once
    exiting = true;

    // The deadline is a safety net for a hung network, not a race with the
    // cleanup. It used to be a 100ms grace-exit, which a passing test suite
    // never caught because the stub PostgREST answers instantly — against the
    // real database the sweep needs several round-trips, so the process exited
    // mid-flight and left the very rows this guard exists to remove.
    const finalCode = () => (code === 0 && (blocked || process.exitCode === 1) ? 1 : code);
    const deadline = setTimeout(() => {
      log(`cleanup exceeded ${CLEANUP_DEADLINE_MS}ms; exiting anyway`);
      void exitCleanly(finalCode());
    }, CLEANUP_DEADLINE_MS);

    runCleanups(reason)
      .catch((error) => log(`cleanup failed outright: ${error?.message ?? error}`))
      .finally(() => {
        clearTimeout(deadline);
        // exitCleanly carries the settle delay, so the loop is never torn down
        // while a fetch handle is closing (the Windows UV_HANDLE_CLOSING abort).
        void exitCleanly(finalCode());
      });
  }

  // ── Preflight: never stack a run on a previous run's leftovers ─────────────
  let leftoverRows;
  try {
    leftoverRows = await findMarked();
  } catch (error) {
    log(`could not reach the database at ${rest}: ${error?.message ?? error}`);
    log("the driver's own database must be the one the app under test uses — point TP_E2E_REST at it (with TP_E2E_ALLOW_LIVE_DB=1 if it is not loopback)");
    void exitCleanly(3);
    return new Promise(() => {});
  }

  if (leftoverRows.length) {
    if (process.env.TP_E2E_ALLOW_LEFTOVERS === "1") {
      log(`WARNING: ${leftoverRows.length} leftover ${marker} row(s) present — continuing because TP_E2E_ALLOW_LEFTOVERS=1`);
      log(describe(leftoverRows));
      log("they are not this run's rows: the sweep will not delete them");
    } else {
      log(`refusing to run ${name}: ${leftoverRows.length} row(s) from a previous run still exist`);
      log(describe(leftoverRows));
      if (leftoverRows.some(isProtected)) {
        log("at least one is approved — a driver never deletes an approved request, because its historical costing row cascades with it");
      }
      log("clean them up first, then re-run:");
      log(`    node scripts/cleanup-test-requests.mjs --marker=${marker} --apply`);
      log("(set TP_E2E_ALLOW_LEFTOVERS=1 to run anyway — not recommended)");
      void exitCleanly(2);
      return new Promise(() => {});
    }
  }

  // ── One run per database: the second start refuses instead of racing ───────
  const lock = acquireLock(lockPath, name, runId);
  if (!lock.ok) {
    const held = lock.held;
    log(`refusing to run ${name}: another driver run is using ${rest}`);
    if (held) log(`    run ${held.runId} "${held.name}" pid ${held.pid} started ${held.startedAt}`);
    log(`    lock: ${lockPath}`);
    log("wait for it to finish; delete that file only if you know the process is gone");
    void exitCleanly(3);
    return new Promise(() => {});
  }
  // A driver that simply ends without calling finish() still frees the lock.
  process.on("exit", () => releaseLock(lockPath, runId));

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

  log(`${name} starting (marker: ${marker}, run: ${runId})`);

  return {
    /** This run's id: write it into every row you create, so the sweep can tell. */
    id: runId,
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
    /** Success path: clean up; `blocked` means rows are still in the database. */
    async finish() {
      if (!finished) {
        finished = true;
        await runCleanups("run finished");
      }
      return { blocked };
    },
    /** Current marker rows, for assertions and diagnostics. */
    leftovers: findMarked
  };
}
