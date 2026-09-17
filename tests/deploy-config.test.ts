import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// Cron runs three of these scripts directly, with no shell in front of them, so
// the files ARE the contract: a CRLF ending or a missing execute bit turns every
// job into a line in a log file that nobody reads. That already happened — ten
// days of silent backup, healthcheck and notification outages, 10,072 identical
// "Permission denied" lines — and a wrong proxy port is the same class of bug:
// invisible to `nginx -t`, visible only as a 502.
//
// These are cheap file properties, so they are pinned here where a renamed script
// or a stray port edit fails CI instead of production.

const read = (path: string) => readFileSync(path, "utf8");

/** The port the app container actually publishes, from the compose file. */
function publishedPort(): string {
  const match = read("deploy/docker-compose.costing.yml").match(/"(\d+):\d+"/);
  if (!match) throw new Error("no published port found in deploy/docker-compose.costing.yml");
  return match[1];
}

const CRON_INVOKED = ["backup-tp-costing.sh", "healthcheck-tp-costing.sh", "process-notifications.sh"];

describe("deploy config", () => {
  it("proxies nginx to the port the app container actually publishes", () => {
    const port = publishedPort();
    const proxies = [...read("deploy/nginx-smart-tp-costing.conf").matchAll(/proxy_pass\s+http:\/\/127\.0\.0\.1:(\d+)/g)];
    expect(proxies.length).toBeGreaterThan(0);
    for (const [, proxyPort] of proxies) expect(proxyPort).toBe(port);
  });

  it("points every ops script at that same port", () => {
    const port = publishedPort();

    const healthChecks = [...read("deploy/deploy-vps.sh").matchAll(/127\.0\.0\.1:(\d+)\/api\/health/g)].map(([, p]) => p);
    expect(healthChecks).toContain(port);
    // Port 80 is the nginx proxy check; anything else must be the app itself.
    for (const healthPort of healthChecks.filter((p) => p !== "80")) expect(healthPort).toBe(port);

    expect(read("deploy/process-notifications.sh")).toContain(`127.0.0.1:${port}`);
  });

  it("ships every deploy file with LF endings", () => {
    const shipped = readdirSync("deploy").filter((name) => /\.(sh|conf|yml|sql)$/.test(name));
    expect(shipped.length).toBeGreaterThan(10);
    expect(shipped.filter((name) => read(`deploy/${name}`).includes("\r"))).toEqual([]);
  });

  it("forces LF in git, because the VPS receives a plain copy of this working tree", () => {
    // There is no git checkout on the VPS — files are copied from a Windows
    // checkout kept CRLF by core.autocrlf — so .gitattributes is the only thing
    // that decides the endings that land there.
    const attributes = read(".gitattributes");
    for (const pattern of ["*.sh", "deploy/*.conf", "deploy/*.yml", "deploy/*.sql"]) {
      const literal = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(attributes).toMatch(new RegExp(`${literal}\\s+text\\s+eol=lf`));
    }
  });

  it("gives every cron-invoked script a clean shebang", () => {
    for (const script of CRON_INVOKED) {
      expect(read(`deploy/${script}`).split("\n")[0]).toBe("#!/usr/bin/env sh");
    }
  });

  it("makes the whole deploy directory executable on deploy, not just migrations", () => {
    // The outage: deploy-vps.sh chmod'd apply-migrations.sh only, and cron's three
    // direct invocations failed with "Permission denied" from that day on.
    const deployVps = read("deploy/deploy-vps.sh");
    expect(deployVps).toContain('chmod +x "$APP_ROOT"/deploy/*.sh');
  });

  it("strips CRLF from the deploy directory on deploy", () => {
    const deployVps = read("deploy/deploy-vps.sh");
    expect(deployVps).toMatch(/sed -i 's\/\\r\$\/\/' "\$APP_ROOT"\/deploy\/\*\.sh/);
  });

  it("runs migrations as the schema owner, not a hardcoded postgres", () => {
    // Part of tp_costing is owned by supabase_admin, and the image's postgres
    // role is not a superuser, so a hardcoded `-U postgres` fails with
    // "must be owner of table" — mid-rollout, after the code swap.
    const runner = read("deploy/apply-migrations.sh");
    expect(runner).toContain('DB_USER="${DB_USER:-}"');
    expect(runner).toContain("supabase_admin");
    expect(runner).not.toMatch(/psql -U postgres -d postgres/);
  });

  it("migrates before swapping the app directory", () => {
    // A migration failure after the swap leaves the code on the new version and
    // the container on the old image: half deployed.
    const rollout = read("deploy/rollout-security.sh");
    const migrateAt = rollout.indexOf('APP_ROOT="$NEW"');
    const swapAt = rollout.indexOf('mv "$CURRENT" "$PREVIOUS"');
    expect(migrateAt).toBeGreaterThan(-1);
    expect(swapAt).toBeGreaterThan(-1);
    expect(migrateAt).toBeLessThan(swapAt);
  });

  it("refuses to overwrite a certbot-managed nginx config without FORCE_NGINX=1", () => {
    const deployVps = read("deploy/deploy-vps.sh");
    expect(deployVps).toContain("FORCE_NGINX");
    // The live config carries the 443/SSL block certbot wrote; overwriting it
    // drops HTTPS, and `nginx -t` still passes because a dead port is valid config.
    expect(deployVps).toMatch(/if \[ -f "\$NGINX_CONF" \] && \[ "\$\{FORCE_NGINX:-0\}" != "1" \]/);
  });
});
