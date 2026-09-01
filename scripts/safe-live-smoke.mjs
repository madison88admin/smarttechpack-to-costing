const BASE = process.argv[2] || "http://localhost:3120";

const USERS = [
  { username: "superadmin@test.local", password: "superadmin", role: "superadmin" },
  { username: "admin@test.local", password: "admin", role: "admin" },
  { username: "pbd@test.local", password: "pbd", role: "pbd" },
  { username: "md@test.local", password: "md", role: "md" },
  { username: "costing@test.local", password: "costing", role: "costing" },
  { username: "factory@test.local", password: "factory", role: "factory" },
  { username: "tp.viewer@madison88.com", password: "viewer", role: "viewer" },
];

let passed = 0;
let failed = 0;

function pass(message) {
  passed += 1;
  console.log(`  PASS ${message}`);
}

function fail(message, detail = "") {
  failed += 1;
  console.log(`  FAIL ${message}${detail ? ` (${detail})` : ""}`);
}

function expectStatus(label, actual, expected) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (allowed.includes(actual)) pass(`${label}: HTTP ${actual}`);
  else fail(label, `expected ${allowed.join("/")}, received ${actual}`);
}

function cookieFrom(response) {
  return (response.headers.get("set-cookie") || "")
    .split(/,(?=\s*[^;,]+=)/)
    .map((part) => part.match(/^\s*([^=]+=[^;]+)/)?.[1] || "")
    .filter(Boolean)
    .join("; ");
}

async function login(user, ipIndex) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `10.90.${ipIndex}.1`,
    },
    body: JSON.stringify({ username: user.username, password: user.password }),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body, cookie: cookieFrom(response) };
}

async function request(path, { cookie, method = "GET", body, redirect = "manual" } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    redirect,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function main() {
  console.log(`\nSmart TP safe live smoke/negative test — ${BASE}\n`);

  expectStatus("Application responds", (await request("/login")).status, 200);

  const sessions = {};
  for (const [index, user] of USERS.entries()) {
    const result = await login(user, index + 1);
    if (result.response.ok && result.body.ok && result.body.role === user.role && result.cookie) {
      sessions[user.role] = result.cookie;
      pass(`${user.role} login and role mapping`);
    } else {
      fail(`${user.role} login`, `HTTP ${result.response.status}, role=${result.body.role || "none"}`);
    }
  }

  const malformedLogin = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.91.0.1" },
    body: "{bad json",
  });
  expectStatus("Malformed login payload fails closed", malformedLogin.status, [400, 401]);

  const injectionLogin = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.92.0.1" },
    body: JSON.stringify({ username: "' OR 1=1 --", password: "x" }),
  });
  expectStatus("SQL-injection-style login is rejected", injectionLogin.status, 401);

  expectStatus(
    "Unauthenticated request API is blocked",
    (await request("/api/costing/requests")).status,
    401,
  );
  expectStatus(
    "Unauthenticated create is blocked",
    (await request("/api/costing/requests", {
      method: "POST",
      body: { styleNumber: "SHOULD-NOT-CREATE", styleName: "Unauthorized" },
    })).status,
    401,
  );

  const pbdList = await request("/api/costing/requests?limit=1", { cookie: sessions.pbd });
  expectStatus("PBD can read request queue", pbdList.status, 200);
  const pbdBody = await pbdList.json().catch(() => ({}));
  const firstRequest = pbdBody?.data?.requests?.[0] || pbdBody?.data?.[0];
  const requestId = firstRequest?.id;

  for (const role of ["md", "costing", "viewer"]) {
    const response = await request("/api/costing/requests?limit=5", { cookie: sessions[role] });
    expectStatus(`${role} can read its authorized queue`, response.status, 200);
  }
  expectStatus(
    "Factory cannot enumerate the internal request API",
    (await request("/api/costing/requests?limit=5", { cookie: sessions.factory })).status,
    403,
  );

  for (const path of ["/reports", "/finance", "/history", "/production", "/like-styles"]) {
    const response = await request(path, { cookie: sessions.factory });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")?.includes("/factory")) {
      pass(`Factory blocked from internal page ${path}`);
    } else {
      fail(`Factory blocked from internal page ${path}`, `HTTP ${response.status}, location=${response.headers.get("location") || "none"}`);
    }
  }

  expectStatus(
    "Factory cannot export historical costing",
    (await request("/api/export/history.csv", { cookie: sessions.factory })).status,
    403,
  );

  if (!requestId) {
    fail("Negative workflow tests", "no request was available in the PBD queue");
  } else {
    expectStatus(
      "Unknown workflow action is rejected",
      (await request(`/api/costing/requests/${requestId}/actions`, {
        cookie: sessions.pbd,
        method: "POST",
        body: { action: "drop_everything", comment: "negative test" },
      })).status,
      400,
    );
    expectStatus(
      "Factory cannot approve",
      (await request(`/api/costing/requests/${requestId}/actions`, {
        cookie: sessions.factory,
        method: "POST",
        body: { action: "approve", comment: "must not be applied" },
      })).status,
      403,
    );
    expectStatus(
      "Costing cannot perform PBD approval",
      (await request(`/api/costing/requests/${requestId}/actions`, {
        cookie: sessions.costing,
        method: "POST",
        body: { action: "approve", comment: "must not be applied" },
      })).status,
      403,
    );
    expectStatus(
      "MD cannot perform PBD approval",
      (await request(`/api/costing/requests/${requestId}/actions`, {
        cookie: sessions.md,
        method: "POST",
        body: { action: "approve", comment: "must not be applied" },
      })).status,
      403,
    );
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed\n`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
