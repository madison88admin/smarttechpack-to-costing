import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { lockPathFor } from "../scripts/lib/driver-guard.mjs";

// The live drivers create real rows in the live database. This suite proves the
// guard's promises with child processes and a stub PostgREST, because the
// interesting paths — Ctrl+C, a crash, a closed stdout — cannot be observed
// from inside the same process.

const GUARD = pathToFileURL(resolve("scripts/lib/driver-guard.mjs")).href;
vi.setConfig({ testTimeout: 30_000 });

type Row = { id: string; request_number: string; status: string; factory_name: string; created_at: string; notes?: string };

let server: Server;
let rest: string;
let rows: Row[];
let deletes: string[];
let creates: number;
let root: string;
// The live sweep talks to a remote PostgREST; the stub answers instantly unless
// a test makes it slow, which is how a too-eager exit grace hides a lost row.
let delayMs: number;

function startStub() {
  return new Promise<void>((done) => {
    server = createServer((req, res) => {
      if (delayMs) return void setTimeout(() => respond(req, res), delayMs);
      respond(req, res);
    });
    const respond = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      res.setHeader("Content-Type", "application/json");
      if (req.method === "GET" && url.pathname === "/costing_requests") {
        res.end(JSON.stringify(rows));
        return;
      }
      if (req.method === "DELETE" && url.pathname === "/costing_requests") {
        const id = (url.searchParams.get("id") ?? "").replace(/^eq\./, "");
        deletes.push(id);
        rows = rows.filter((row) => row.id !== id);
        res.statusCode = 204;
        res.end();
        return;
      }
      // Test-only: simulates the app creating a request the driver owns.
      if (req.method === "POST" && url.pathname === "/__create") {
        creates += 1;
        const id = `req-${creates}`;
        rows.push({
          id,
          request_number: `CR-TEST-${creates}`,
          status: url.searchParams.get("status") ?? "draft",
          factory_name: "STUB FACTORY",
          created_at: "2026-09-16T00:00:00Z",
          // Ownership lives in the notes: the guard deletes only its own run's rows.
          notes: url.searchParams.get("notes") ?? ""
        });
        res.statusCode = 201;
        res.end(JSON.stringify({ id }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    };
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      rest = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/costing_requests`.replace(/\/costing_requests$/, "");
      done();
    });
  });
}

type ChildResult = { code: number | null; signal: string | null; output: string };

/** Runs a driver-shaped child: guard first, then the scenario body. */
function runChild(body: string, options: { closeStdout?: boolean; env?: Record<string, string> } = {}): Promise<ChildResult> {
  const scenario = `
import { beginDriverRun } from ${JSON.stringify(GUARD)};
import { readFileSync } from "node:fs";

const REST = ${JSON.stringify("__REST__")};
const headers = { "Content-Type": "application/json" };
const run = await beginDriverRun({ name: "guard-test", marker: "MARKER-1", rest: REST, headers });
${body}
`;
  const file = join(root, `child-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, scenario.replace("__REST__", rest));

  // Ambient driver settings must not leak into a test: the lock lives in the
  // per-test root, and a leftover/updated-TTL value from the developer's shell
  // would silently change which path is under test.
  const ambient = { ...process.env };
  delete ambient.TP_E2E_ALLOW_LEFTOVERS;
  delete ambient.TP_E2E_LOCK_TTL_MS;

  return new Promise((done) => {
    const child = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"], env: { ...ambient, TP_E2E_LOCK_DIR: root, ...options.env } });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", () => done({ code: 1, signal: null, output }));
    // Closing the read end is what `driver | head` does to the driver.
    if (options.closeStdout) child.stdout.destroy();
    child.on("close", (code, signal) => done({ code, signal, output }));
  });
}

// The real drivers write `run.id` into every row they create; that is what
// makes a row provably this run's, so the stub rows carry it too.
const CREATE_ROW = `await fetch(REST + "/__create?notes=" + encodeURIComponent("MARKER-1 " + run.id), { method: "POST", headers });`;
const CREATE_APPROVED_ROW = `await fetch(REST + "/__create?status=approved&notes=" + encodeURIComponent("MARKER-1 " + run.id), { method: "POST", headers });`;
/** A row another run created: same marker, someone else's id in the notes. */
const CREATE_FOREIGN_ROW = `await fetch(REST + "/__create?notes=" + encodeURIComponent("MARKER-1 someone-elses-run"), { method: "POST", headers });`;

beforeEach(async () => {
  rows = [];
  deletes = [];
  creates = 0;
  delayMs = 0;
  root = mkdtempSync(join(tmpdir(), "tp-guard-"));
  await startStub();
});

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(root, { recursive: true, force: true });
});

// Every case here spawns a child process and waits for its cleanup to settle; the
// slowest already takes ~3s, so the 5s default made a busy machine look like a
// broken guard.
describe("driver guard", { timeout: 20_000 }, () => {
  it("refuses to start while a previous run's rows still exist", async () => {
    rows = [{ id: "old-1", request_number: "CR-OLD-1", status: "draft", factory_name: "STUB FACTORY", created_at: "2026-09-15T00:00:00Z", notes: "MARKER-1 an-earlier-run" }];

    const result = await runChild(CREATE_ROW);

    expect(result.code).toBe(2);
    expect(result.output).toContain("refusing to run");
    expect(result.output).toContain("CR-OLD-1");
    expect(creates).toBe(0); // nothing new was created on top of the leftovers
    expect(deletes).toHaveLength(0); // and nothing was deleted behind the operator's back
  });

  // Regression: the drivers end a failed run with a bare `process.exit(1)`, and
  // that killed the sweep mid-flight — observed live, where the guard logged
  // "cleaning up (stdout closed (EPIPE))" and then died, stranding a request.
  it("cleans up even when the driver exits the process itself", async () => {
    const result = await runChild(`${CREATE_ROW}\nprocess.exit(1);\nawait new Promise((r) => setTimeout(r, 5000));`);

    expect(result.code).toBe(1);
    expect(rows).toHaveLength(0);
    expect(deletes).toContain("req-1");
  });

  it("mirrors its messages to TP_E2E_LOG when stdout is all that is left", async () => {
    const logFile = join(root, "guard.log");
    await runChild(`${CREATE_ROW}\nawait run.finish();`, { env: { TP_E2E_LOG: logFile } });

    const mirrored = readFileSync(logFile, "utf8");
    expect(mirrored).toContain("starting (marker: MARKER-1, run:");
    expect(mirrored).toContain("clean — no MARKER-1 rows remain");
  });

  it("cleans up rows it never tracked when the run throws", async () => {
    const result = await runChild(`${CREATE_ROW}\nthrow new Error("scenario exploded");`);

    expect(result.code).not.toBe(0);
    expect(rows).toHaveLength(0);
    expect(deletes).toContain("req-1"); // the marker sweep found it without being told the id
    expect(result.output).toContain("scenario exploded");
  });

  // Signal *delivery* is the platform's job (Windows cannot raise SIGINT in a
  // child at all), so these dispatch exactly the event the guard listens for.
  // What is under test is the handler: clean up, then exit with the right code.
  it("cleans up on Ctrl+C instead of abandoning the rows", async () => {
    const result = await runChild(`${CREATE_ROW}\nprocess.emit("SIGINT");\nawait new Promise((r) => setTimeout(r, 3000));`);

    expect(result.code).toBe(130);
    expect(rows).toHaveLength(0);
    expect(deletes).toContain("req-1");
    expect(result.output).toContain("SIGINT received");
  });

  // Regression: the exit grace used to be 100ms, which a passing suite never
  // caught because the stub answers instantly — against the real database the
  // process exited mid-sweep and left the rows behind.
  it("finishes a cleanup that is slower than a graceful exit would allow", async () => {
    delayMs = 400;
    const result = await runChild(`${CREATE_ROW}\nprocess.emit("SIGINT");\nawait new Promise((r) => setTimeout(r, 5000));`);

    expect(result.code).toBe(130);
    expect(rows).toHaveLength(0);
    expect(deletes).toContain("req-1");
    expect(result.output).toContain("clean — no MARKER-1 rows remain");
  });

  it("cleans up when stdout is closed by a pipe (EPIPE)", async () => {
    const result = await runChild(
      `${CREATE_ROW}\nprocess.stdout.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));\nawait new Promise((r) => setTimeout(r, 3000));`
    );

    expect(result.code).toBe(0);
    expect(rows).toHaveLength(0);
    expect(deletes).toContain("req-1");
    expect(result.output).toContain("stdout closed (EPIPE)");
  });

  it("reports a clean run and leaves nothing behind on the success path", async () => {
    const result = await runChild(`${CREATE_ROW}\nawait run.finish();`);

    expect(result.code).toBe(0);
    expect(rows).toHaveLength(0);
    expect(result.output).toContain("clean — no MARKER-1 rows remain");
    // The lock is released, or the next run waits six hours for a dead one.
    expect(existsSync(lockPathFor(rest, root))).toBe(false);
  });

  it("deletes rows a run tracked even when their marker is missing", async () => {
    // Belt and braces: a tracked id is removed even if the marker query misses it.
    const result = await runChild(`${CREATE_ROW}\nrun.trackRequest("req-1");\nawait run.finish();`);

    expect(result.code).toBe(0);
    expect(deletes.filter((id) => id === "req-1").length).toBeGreaterThanOrEqual(1);
  });

  // An approved request owns a historical costing row; deleting it takes that
  // row with it, which is how the cost library lost a row before. The sweep
  // therefore never deletes one, and the run fails loudly instead of sweeping
  // the problem under the rug.
  it("leaves an approved row in place instead of cascading its historical costing row", async () => {
    rows = []; // preflight passes; the run then creates an approved row
    const result = await runChild(`${CREATE_APPROVED_ROW}\nawait run.finish();`);

    expect(result.code).toBe(1);
    expect(rows).toHaveLength(1); // still there
    expect(deletes).toHaveLength(0); // nothing was deleted
    expect(result.output).toContain("never deletes an approved request");
    expect(result.output).toContain("FAILING this run");
    expect(result.output).toContain("cleanup-test-requests.mjs --marker=MARKER-1 --apply");
  });

  // The division of ownership: the driver's own tracked cleanup removes the
  // exact rows it created — including an approved one, whose cascade it also
  // removes — while the guard's discovery sweep keeps its hands off anything it
  // cannot prove is this run's.
  it("removes an approved row the driver explicitly tracked", async () => {
    const result = await runChild(`${CREATE_APPROVED_ROW}\nrun.trackRequest("req-1");\nawait run.finish();`);

    expect(result.code).toBe(0);
    expect(rows).toHaveLength(0);
    expect(deletes).toContain("req-1");
  });

  // The marker alone is not ownership: it also matches another run's in-flight
  // rows, and deleting those is how one run destroys another's work.
  it("never deletes a row another run created, and fails the run that finds one", async () => {
    const result = await runChild(`${CREATE_ROW}\n${CREATE_FOREIGN_ROW}\nawait run.finish();`);

    expect(deletes).toContain("req-1"); // our own row is swept
    expect(deletes).not.toContain("req-2"); // the other run's row is not touched
    expect(rows.map((row) => row.id)).toEqual(["req-2"]);
    expect(result.code).toBe(1); // and the run says so instead of claiming clean
    expect(result.output).toContain("were not created by this run");
    expect(result.output).toContain("cleanup-test-requests.mjs");
  });

  // Two near-simultaneous starts used to both proceed and then delete each
  // other's rows. The lock makes the second one refuse.
  it("refuses a second run against the same database while one is live", async () => {
    writeFileSync(
      lockPathFor(rest, root),
      JSON.stringify({ runId: "other-run", name: "e2e-live", pid: process.pid, startedAt: new Date().toISOString() })
    );

    const result = await runChild(CREATE_ROW);

    expect(result.code).toBe(3);
    expect(result.output).toContain("another driver run is using");
    expect(result.output).toContain("e2e-live");
    expect(creates).toBe(0);
    expect(deletes).toHaveLength(0);
    // Refusing must not take the other run's lock away with it.
    expect(existsSync(lockPathFor(rest, root))).toBe(true);
  });

  it("takes over a lock whose run is gone instead of refusing forever", async () => {
    writeFileSync(
      lockPathFor(rest, root),
      JSON.stringify({ runId: "dead-run", name: "e2e-live", pid: 999999, startedAt: "2020-01-01T00:00:00Z" })
    );

    const result = await runChild(`${CREATE_ROW}\nawait run.finish();`);

    expect(result.output).toContain("taking over the lock");
    expect(result.code).toBe(0);
    expect(rows).toHaveLength(0);
  });

  it("surfaces rows it could not remove instead of claiming success", async () => {
    // The DELETE is rejected, so the sweep cannot clear the row.
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      res.setHeader("Content-Type", "application/json");
      if (req.method === "GET") return void res.end(JSON.stringify(rows));
      if (req.method === "POST" && url.pathname === "/__create") {
        creates += 1;
        rows.push({ id: `req-${creates}`, request_number: `CR-TEST-${creates}`, status: "draft", factory_name: "STUB FACTORY", created_at: "2026-09-16T00:00:00Z", notes: url.searchParams.get("notes") ?? "" });
        res.statusCode = 201;
        return void res.end("{}");
      }
      res.statusCode = 500; // every DELETE fails
      res.end("{}");
    });

    const result = await runChild(`${CREATE_ROW}\nawait run.finish();`);

    expect(result.output).toContain("this run created are still there");
    expect(result.output).toContain("FAILING this run");
    expect(result.code).toBe(1);
  });
});
