import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// The VPS backup script runs `docker exec` against the Supabase db container,
// which no test environment has. These tests put a stub `docker` on PATH that
// answers exactly the two calls the script makes (pg_dump and psql), so the
// script's real logic is exercised: dump verification, the manifest, and the
// retention floor. A backup script that silently writes an empty dump is worse
// than none, so every failure mode below is pinned.

const SCRIPT = "deploy/backup-tp-costing.sh";

// Every case shells out to `sh` and spawns process trees for the stub docker,
// so they need a real budget — the 5s default flakes under parallel load.
vi.setConfig({ testTimeout: 30_000 });

let root: string;
let backupDir: string;
let binDir: string;

/** Stub docker: `pg_dump` emits a fake dump, `psql` emits fake counts. */
function writeDockerStub(options: { dumpBody?: string; emptyDump?: boolean; failDump?: boolean } = {}) {
  const body = options.dumpBody ?? "CREATE TABLE tp_costing.historical_costings (id uuid);\nCREATE TABLE tp_costing.costing_requests (id uuid);";
  const script = `#!/usr/bin/env sh
if [ "$1" = "exec" ]; then
  shift 2 # container, command
  command="$1"; shift
  case "$command" in
    pg_dump)
      if [ "\${STUB_FAIL_DUMP:-}" = "1" ]; then echo "pg_dump: connection refused" >&2; exit 1; fi
      if [ "\${STUB_EMPTY_DUMP:-}" = "1" ]; then exit 0; fi
      if [ "\${STUB_MISSING_TABLE:-}" = "1" ]; then printf 'CREATE TABLE tp_costing.something_else (id uuid);\\n'; exit 0; fi
      printf '${body}\\nCREATE TABLE auth.users (id uuid);\\n'
      exit 0
      ;;
    psql)
      printf 'count_costing_requests=26\\ncount_historical_costings=2828\\ncount_factory_cbds=23\\ncount_user_profiles=13\\nlatest_historical_approved=2026-09-16T05:07:40+00:00\\n'
      exit 0
      ;;
  esac
fi
exit 0
`;
  writeFileSync(join(binDir, "docker"), script);
  chmodSync(join(binDir, "docker"), 0o755);
}

function runScript(args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync("sh", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      TP_COSTING_BACKUP_DIR: backupDir,
      ...env
    }
  });
}

function dumps() {
  return readdirSync(backupDir).filter((file) => file.endsWith(".sql.gz")).sort();
}

/** The app-schema dumps only — `--check` reports just these. */
function appDumps() {
  return dumps().filter((file) => file.startsWith("tp_costing_"));
}

/** Writes an old dump whose mtime is distinct, so prune order is deterministic. */
function writeOldDump(day: number) {
  const file = join(backupDir, `tp_costing_2020010${day}T000000Z.sql.gz`);
  writeFileSync(file, "old");
  writeFileSync(join(backupDir, `tp_costing_2020010${day}T000000Z.manifest`), "stamp=old");
  // Distinct dates: with equal mtimes the "oldest" file is arbitrary.
  spawnSync("touch", ["-d", `2020-01-0${day + 1}T00:00:00`, file]);
  return file;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tp-backup-"));
  backupDir = join(root, "backups");
  binDir = join(root, "bin");
  mkdirSync(binDir);
  writeDockerStub();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("deploy/backup-tp-costing.sh", () => {
  it("writes the app and auth dumps plus a manifest of what they contain", () => {
    const result = runScript();

    expect(result.status).toBe(0);
    expect(dumps()).toHaveLength(2);
    expect(dumps().some((f) => f.startsWith("tp_costing_"))).toBe(true);
    expect(dumps().some((f) => f.startsWith("auth_"))).toBe(true);

    const manifest = readdirSync(backupDir).find((f) => f.endsWith(".manifest"));
    expect(manifest).toBeDefined();
    const text = readFileSync(join(backupDir, manifest!), "utf8");
    // The manifest is the only thing that says which dump still holds a row
    // that has since been deleted.
    expect(text).toContain("count_historical_costings=2828");
    expect(text).toContain("count_costing_requests=26");
    expect(text).toContain("latest_historical_approved=");
  });

  it("refuses to keep a dump that is missing the app's core table", () => {
    const result = runScript([], { STUB_MISSING_TABLE: "1" });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("does not contain tp_costing.historical_costings");
    // No half-verified file is left behind pretending to be a backup.
    expect(dumps()).toHaveLength(0);
  });

  it("fails loudly on an empty dump instead of recording a successful backup", () => {
    const result = runScript([], { STUB_EMPTY_DUMP: "1" });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("empty dump");
    expect(dumps()).toHaveLength(0);
  });

  it("fails when pg_dump itself errors, leaving nothing behind", () => {
    const result = runScript([], { STUB_FAIL_DUMP: "1" });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("pg_dump of schema tp_costing returned an error");
    expect(dumps()).toHaveLength(0);
  });

  it("keeps the newest backups even when they are older than the retention window", () => {
    // Six ancient dumps with a floor of seven: nothing may be pruned.
    mkdirSync(backupDir, { recursive: true });
    for (let i = 0; i < 6; i += 1) writeOldDump(i);

    const result = runScript([], { TP_COSTING_BACKUP_KEEP_MINIMUM: "7", TP_COSTING_BACKUP_RETENTION_DAYS: "30" });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("pruned");
    expect(appDumps()).toHaveLength(7); // 6 kept by the floor + this run's dump
  });

  it("prunes the oldest dump past the retention window once the floor is satisfied", () => {
    mkdirSync(backupDir, { recursive: true });
    for (let i = 0; i < 8; i += 1) writeOldDump(i);

    const result = runScript([], { TP_COSTING_BACKUP_KEEP_MINIMUM: "7", TP_COSTING_BACKUP_RETENTION_DAYS: "30" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pruned");
    // Nine candidates (8 old + this run), floor 7 → the two oldest go, and each
    // takes its manifest with it.
    expect(appDumps()).toHaveLength(7);
    expect(dumps()).not.toContain("tp_costing_20200100T000000Z.sql.gz");
    expect(readdirSync(backupDir)).not.toContain("tp_costing_20200100T000000Z.manifest");
  });

  // Manual archives (the pre-incident dumps) are the only remaining copy of
  // rows deleted before the schedule existed — retention must not eat them.
  it("never prunes a manually named archive, however old", () => {
    mkdirSync(backupDir, { recursive: true });
    const archival = join(backupDir, "tp_costing_pre_security_20200801T000000Z.sql.gz");
    writeFileSync(archival, "archive");
    spawnSync("touch", ["-d", "2020-08-01T00:00:00", archival]);
    // Beyond the floor, so age-based pruning would otherwise take it.
    for (let i = 0; i < 9; i += 1) writeOldDump(i);

    const result = runScript([], { TP_COSTING_BACKUP_KEEP_MINIMUM: "3", TP_COSTING_BACKUP_RETENTION_DAYS: "30" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("keeping tp_costing_pre_security_20200801T000000Z.sql.gz");
    expect(readdirSync(backupDir)).toContain("tp_costing_pre_security_20200801T000000Z.sql.gz");
  });

  it("reports the newest backup without writing one", () => {
    runScript();
    const before = appDumps().length;

    const check = runScript(["--check"]);

    expect(check.status).toBe(0);
    expect(check.stdout).toContain("dumps on disk: " + before);
    expect(check.stdout).toContain("count_historical_costings=2828");
    expect(dumps()).toHaveLength(before + 1); // still app + auth
  });

  it("says so plainly when nothing has ever been backed up", () => {
    const check = runScript(["--check"]);

    expect(check.status).toBe(0);
    expect(check.stdout).toContain("no backup directory yet");
  });
});

// The installer runs once by hand and must be safe to re-run: a duplicated cron
// line means two dumps at 02:00, and a dropped line means no backups at all.
describe("deploy/install-backup-cron.sh", () => {
  function writeCrontabStub() {
    writeFileSync(
      join(binDir, "crontab"),
      `#!/usr/bin/env sh
store="$CRONTAB_STORE"
if [ "\${1:-}" = "-l" ]; then [ -f "$store" ] && cat "$store"; exit 0; fi
cp "$1" "$store"
touch "$store.applied"
`
    );
    chmodSync(join(binDir, "crontab"), 0o755);
  }

  function runInstaller(appRoot: string) {
    return spawnSync("sh", ["deploy/install-backup-cron.sh"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        APP_ROOT: appRoot,
        CRONTAB_STORE: join(root, "crontab.txt")
      }
    });
  }

  function fakeAppRoot() {
    const appRoot = join(root, "app");
    mkdirSync(join(appRoot, "deploy"), { recursive: true });
    const source = readFileSync(SCRIPT, "utf8");
    writeFileSync(join(appRoot, "deploy", "backup-tp-costing.sh"), source);
    chmodSync(join(appRoot, "deploy", "backup-tp-costing.sh"), 0o755);
    return appRoot;
  }

  beforeEach(() => {
    writeCrontabStub();
  });

  it("installs the daily backup line and keeps it to one copy on re-run", () => {
    const appRoot = fakeAppRoot();
    const store = join(root, "crontab.txt");
    // A pre-existing, unrelated cron line must survive the install.
    writeFileSync(store, "0 9 * * * /usr/bin/health-check\n");

    expect(runInstaller(appRoot).status).toBe(0);
    expect(runInstaller(appRoot).status).toBe(0);

    const lines = readFileSync(store, "utf8").trim().split("\n");
    expect(lines.filter((line) => line.includes("backup-tp-costing.sh"))).toHaveLength(1);
    expect(lines.some((line) => line.includes("health-check"))).toBe(true);
    expect(lines.find((line) => line.includes("backup-tp-costing.sh"))).toContain("0 2 * * *");
  });

  it("refuses to install when the backup script is missing", () => {
    const emptyRoot = join(root, "empty-app");
    mkdirSync(emptyRoot, { recursive: true });

    const result = runInstaller(emptyRoot);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("backup script not executable");
  });
});
