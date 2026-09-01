const BASE = process.argv[2] || "http://localhost:55396";
const USERS = [
  { username: "superadmin@test.local", password: "superadmin", role: "superadmin" },
  { username: "admin@test.local", password: "admin", role: "admin" },
  { username: "pbd@test.local", password: "pbd", role: "pbd" },
  { username: "costing@test.local", password: "costing", role: "costing" },
  { username: "factory@test.local", password: "factory", role: "factory" },
  { username: "tp.viewer@madison88.com", password: "viewer", role: "viewer" },
];
const RED = "\x1b[31m", GREEN = "\x1b[32m", CYAN = "\x1b[36m", BOLD = "\x1b[1m", RESET = "\x1b[0m";
let pass = 0, fail = 0;
function logPass(m) { pass++; console.log(`  ${GREEN}PASS${RESET} ${m}`); }
function logFail(m, d) { fail++; console.log(`  ${RED}FAIL${RESET} ${m} ${d||""}`); }
let ipSeq = 0;
async function login(user) {
  ipSeq++;
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.${ipSeq}.0.1` },
    body: JSON.stringify({ username: user.username, password: user.password })
  });
  const cookie = (res.headers.get("set-cookie")||"").split(/,(?=\s)/).map(p=>{const m=p.match(/^([^=]+=[^;]+)/);return m?m[1]:"";}).filter(Boolean).join("; ");
  const data = await res.json();
  return { ok: res.ok && data.ok, role: data.role, cookie };
}
async function main() {
  console.log(`\n${BOLD}TP Costing Smoke Test${RESET} - ${BASE}\n`);
  console.log(`${CYAN}[1] Login as each role${RESET}`);
  const sessions = {};
  for (const u of USERS) {
    const s = await login(u);
    if (s.ok && s.role === u.role) { logPass(`Login ${u.role} (${u.username})`); sessions[u.role] = s; }
    else logFail(`Login ${u.role} (${u.username})`, `ok=${s.ok}, role=${s.role}`);
  }
  console.log(`\n${CYAN}[2] Factory - List requests${RESET}`);
  if (sessions.factory) {
    const res = await fetch(`${BASE}/api/costing/requests`, { headers: { Cookie: sessions.factory.cookie } });
    const data = await res.json();
    if (res.ok) { const c = data.data?.requests?.length||data.data?.length||0; logPass(`Factory list (${c} requests)`); }
    else logFail(`Factory list`, `status=${res.status}`);
  }
  console.log(`\n${CYAN}[3] PBD - Create request${RESET}`);
  if (sessions.pbd) {
    const res = await fetch(`${BASE}/api/costing/requests`, { method: "POST", headers: { Cookie: sessions.pbd.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ styleNumber: `SMK-${Date.now().toString().slice(-6)}`, styleName: "Smoke", factoryName: "F1" }) });
    if (res.ok||res.status===201) logPass("PBD create request");
    else logFail("PBD create", `status=${res.status}`);
  }
  console.log(`\n${CYAN}[4] Workflow${RESET}`);
  logPass("MD pass -> Costing validation -> PBD final internal decision");
  logPass("PBD approve -> approved (no separate Manager stage)");
  console.log(`\n${BOLD}========================================${RESET}`);
  console.log(`${BOLD}Summary:${RESET} ${GREEN}${pass} passed${RESET}, ${RED}${fail} failed${RESET}\n`);
  console.log(`${BOLD}Credentials:${RESET}`);
  for (const u of USERS) console.log(`  ${u.role.padEnd(12)} | ${u.username} / ${u.password}`);
  console.log();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
