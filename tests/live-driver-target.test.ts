import { describe, it, expect, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_REST, LIVE_OPT_IN_ENV, UnsafeDriverTargetError, resolveRestTarget } from "../scripts/lib/rest-target.mjs";

// A live driver writes and deletes real rows, so where it points is a decision
// rather than an inheritance. These are unit-level exercises of that decision
// plus spawns of every real driver — none of them reach a database, which is
// the point: a refusal must be provable without writing to production.
//
// Every driver is covered, not just the role matrix: one of them still holding
// the production URL is the whole hazard this rule exists to remove.

vi.setConfig({ testTimeout: 30_000 });

const LIVE = "http://5.223.78.194:8000/rest/v1";
/** A loopback target nothing can be listening on, so the guard stops at once. */
const LOOPBACK_NO_SERVER = "http://127.0.0.1:1/rest/v1";
const DRIVERS = [
  "scripts/e2e-role-matrix.mjs",
  "scripts/e2e-live.mjs",
  "scripts/e2e-clarify-ls.mjs",
  "scripts/e2e-final-m88.mjs",
  "scripts/e2e-reject-clarify-deep.mjs",
  "scripts/verify-lazy-pricing.mjs"
];
/** The role matrix is the driver with the run-id stamping contract below. */
const ROLE_MATRIX = DRIVERS[0];

type Spawned = { code: number | null; output: string };

/**
 * Runs the real driver with none of the developer's own driver settings.
 *
 * `cwd` defaults to the repository, where the refusal must land without any
 * `.env` file existing at all; the loopback case runs from a scratch directory
 * with a throwaway key so the driver gets as far as the guard without depending
 * on the machine it runs on.
 */
function runDriver(driver: string, env: Record<string, string>, options: { cwd?: string } = {}): Promise<Spawned> {
  const ambient = { ...process.env };
  delete ambient.TP_E2E_ALLOW_LIVE_DB;
  delete ambient.TP_E2E_ALLOW_LEFTOVERS;
  delete ambient.TP_E2E_REST;

  return new Promise((done) => {
    const child = spawn(process.execPath, [join(process.cwd(), driver)], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: options.cwd,
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

  it.each(DRIVERS)("refuses %s before it can write, when the target is live and unacknowledged", async (driver) => {
    const result = await runDriver(driver, { TP_E2E_REST: LIVE, [LIVE_OPT_IN_ENV]: "" });

    expect(result.code).toBe(3);
    expect(result.output).toContain("refusing to write to");
    expect(result.output).toContain(`${LIVE_OPT_IN_ENV}=1`);
    // It never reached the guard, let alone a request — no lock, no write.
    expect(result.output).not.toContain("starting (marker");
    expect(result.output).not.toContain("[guard]");
  });

  it.each(DRIVERS)("hands %s the loopback target without asking for an acknowledgement", async (driver) => {
    const scratch = mkdtempSync(join(tmpdir(), "tp-driver-target-"));
    writeFileSync(join(scratch, ".env.local"), "SUPABASE_SERVICE_ROLE_KEY=target-test-service-key\n");
    try {
      const result = await runDriver(driver, { TP_E2E_REST: LOOPBACK_NO_SERVER }, { cwd: scratch });

      expect(result.output).not.toContain("refusing to write to");
      // The resolved database is what the guard received — it stops at the
      // closed port rather than anywhere else, and writes nothing on the way.
      expect(result.output).toContain(LOOPBACK_NO_SERVER);
      expect(result.output).not.toContain("starting (marker");
      expect(result.code).toBe(3);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it.each(DRIVERS)("keeps the database target out of %s's own source", (driver) => {
    const source = readFileSync(driver, "utf8");

    expect(source).toContain("resolveRestTarget");
    expect(source).not.toContain("5.223.78.194");
    expect(source).toContain("const PGREST = target.rest;");
    expect(source).toContain("rest: PGREST");
  });

  // The sweep deletes only rows carrying this run's id, so the driver has to
  // put it there — otherwise its own rows would be swept by nobody.
  it("stamps every row it creates with the run id the guard sweeps on", () => {
    const source = readFileSync(ROLE_MATRIX, "utf8");

    expect(source).toContain("const probeNotes = () => `role matrix probe [${MARKER} ${run.id}]`");
    expect(source).not.toContain("[${MARKER}]");
    expect(source.match(/notes: probeNotes\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
