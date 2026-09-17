import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

// deploy/apply-migrations.sh applies an explicitly listed set of migrations to
// the VPS database; nothing discovers files. A migration that is never added
// there is simply never applied in production — invisible until someone goes
// looking for a missing table or column. That has already happened once (009's
// metadata_checked_at existed in the repo and not in the live database), so the
// omission is pinned here instead of in a deploy runbook.
//
// The guard deliberately starts at 012: that is the first migration the runner
// ever applied, and the earlier ones were applied by hand before the ledger
// existed, so re-running them is not something this script should do.

const RUNNER = readFileSync("deploy/apply-migrations.sh", "utf8");
const LISTED = [...RUNNER.matchAll(/^apply_migration\s+(\S+)\s+(\S+)\s*$/gm)].map(([, version, file]) => ({ version, file }));

const MIGRATIONS = readdirSync("database/migrations").filter((name) => name.endsWith(".sql"));

describe("deploy migration runner", () => {
  it("applies a non-trivial manifest", () => {
    expect(LISTED.length).toBeGreaterThan(5);
  });

  it("lists every migration from 012 on", () => {
    const listed = LISTED.map((entry) => entry.file);
    const unlisted = MIGRATIONS.filter((name) => /^0(1[2-9]|2\d)_/.test(name) && !listed.includes(name));
    expect(unlisted).toEqual([]);
  });

  it("lists each migration once, applied in version order", () => {
    const versions = LISTED.map((entry) => entry.version);
    const files = LISTED.map((entry) => entry.file);
    expect(new Set(files).size).toBe(files.length);
    expect([...versions].sort()).toEqual(versions);
  });

  it("matches each version to the file that carries it", () => {
    for (const { version, file } of LISTED) {
      expect(MIGRATIONS).toContain(file);
      expect(file.startsWith(`${version}_`)).toBe(true);
    }
  });
});
