import { describe, it, expect, vi } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { DEFAULT_REST, LIVE_OPT_IN_ENV, UnsafeDriverTargetError, resolveRestTarget } from "../scripts/lib/rest-target.mjs";

// A live driver writes and deletes real rows, so where it points is a decision
// rather than an inheritance. These are unit-level exercises of that decision
// plus two spawns of the real driver — none of them reach a database, which is
// the point: a refusal must be provable without writing to production.

vi.setConfig({ testTimeout: 30_000 });

const LIVE = "http://5.223.78.194:8000/rest/v1";
const DRIVER = "scripts/e2e-role-matrix.mjs";

type Spawned = { code: number | null; output: string };

/** Runs the real driver with none of the developer's own driver settings. */
function runDriver(env: Record<string, string>): Promise<Spawned> {
  const ambient = { ...process.env };
  delete ambient.TP_E2E_ALLOW_LIVE_DB;
  delete ambient.TP_E2E_ALLOW_LEFTOVERS;

  return new Promise((done) => {
    const child = spawn(process.execPath, [DRIVER], {
      stdio: ["ignore", "pipe", "pipe"],
      // The session secret only has to exist — the refusal has to land before
      // anything reads it, and continuous integration has no .env files at all.
      env: { ...ambient, TP_COSTING_SESSION_SECRET: "target-test-secret", ...env }
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", () => done({ code: 1, output }));
    child.on("close", (code) => done({ code, output }));
  });
}

describe("driver database target", () => {
  it("defaults to the local database, which cannot be production", () => {
    expect(resolveRestTarget({ env: {} })).toEqual({ rest: DEFAULT_REST, live: false });
    expect(DEFAULT_REST).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  });

  it("allows a loopback database without any acknowledgement", () => {
    expect(resolveRestTarget({ env: { TP_E2E_REST: "http://localhost:54321/rest/v1" } })).toEqual({
      rest: "http://localhost:54321/rest/v1",
      live: false
    });
    expect(resolveRestTarget({ env: { TP_E2E_REST: "http://127.0.0.1:8000/rest/v1" } }).live).toBe(false);
  });

  it("refuses any other database without the explicit opt-in", () => {
    expect(() => resolveRestTarget({ env: { TP_E2E_REST: LIVE } })).toThrow(UnsafeDriverTargetError);
    expect(() => resolveRestTarget({ env: { TP_E2E_REST: LIVE } })).toThrow(/refusing to write to/);
    expect(() => resolveRestTarget({ env: { TP_E2E_REST: LIVE } })).toThrow(
      new RegExp(`${LIVE_OPT_IN_ENV}=1 TP_E2E_REST=`)
    );
  });

  it("allows it once the operator acknowledges it", () => {
    expect(resolveRestTarget({ env: { TP_E2E_REST: LIVE, [LIVE_OPT_IN_ENV]: "1" } })).toEqual({ rest: LIVE, live: true });
  });

  it("refuses the real driver before it can write, when the target is live and unacknowledged", async () => {
    const result = await runDriver({ TP_E2E_REST: LIVE, [LIVE_OPT_IN_ENV]: "" });

    expect(result.code).toBe(3);
    expect(result.output).toContain("refusing to write to");
    expect(result.output).toContain(`${LIVE_OPT_IN_ENV}=1`);
    // It never reached the guard, let alone a request — no lock, no write.
    expect(result.output).not.toContain("starting (marker");
    expect(result.output).not.toContain("[guard]");
  });

  it("keeps the driver's database target out of its own source", () => {
    const source = readFileSync(DRIVER, "utf8");

    expect(source).toContain("resolveRestTarget");
    expect(source).not.toContain("5.223.78.194");
  });

  // The sweep deletes only rows carrying this run's id, so the driver has to
  // put it there — otherwise its own rows would be swept by nobody.
  it("stamps every row it creates with the run id the guard sweeps on", () => {
    const source = readFileSync(DRIVER, "utf8");

    expect(source).toContain("const probeNotes = () => `role matrix probe [${MARKER} ${run.id}]`");
    expect(source).not.toContain("[${MARKER}]");
    expect(source.match(/notes: probeNotes\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
