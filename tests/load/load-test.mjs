// Load test: fires concurrent requests at the export/health endpoints to
// check responsiveness under load. Uses a minted PBD session cookie so the
// auth-required export routes are actually exercised (401s would skew the
// error rate).
//
// Usage:
//   LOAD_TEST_BASE_URL=http://localhost:3120 node tests/load/load-test.mjs
//   LOAD_TEST_DURATION_MS=30000 LOAD_TEST_CONCURRENT=10 npm run test:load

import http from "node:http";
import { URL } from "node:url";
import { mintCookie } from "../../scripts/mint-cookie.mjs";

const BASE_URL = process.env.LOAD_TEST_BASE_URL || "http://localhost:3000";
const DURATION_MS = Number(process.env.LOAD_TEST_DURATION_MS || 30000);
const CONCURRENT = Number(process.env.LOAD_TEST_CONCURRENT || 10);

const SESSION_COOKIE = `tp_costing_session=${mintCookie({
  sub: "3a7c8aba-8ce3-4555-8160-f78407b954ad",
  name: "PBD Test",
  email: "pbd@test.local",
  role: "pbd"
})}`;

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = http.request(url, options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString(),
          ms: Date.now() - start
        });
      });
    });
    req.on("error", (err) => reject(err));
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function loadTest() {
  console.log(`Load test: ${BASE_URL} | ${DURATION_MS}ms | ${CONCURRENT} concurrent (pbd session)`);

  const healthStart = Date.now();
  let healthOk = false;
  try {
    const health = await request(new URL("/api/health", BASE_URL).toString());
    healthOk = health.status === 200;
    console.log(`Health: ${health.status} in ${Date.now() - healthStart}ms`);
  } catch (err) {
    console.error(`Health check failed: ${err instanceof Error ? err.message : err}`);
  }

  if (!healthOk) {
    console.error("Health endpoint not ok — aborting load test. Start the app with: npm run dev");
    process.exit(1);
  }

  const endpoints = [
    "/api/health",
    "/api/costing/requests?limit=20",
    "/api/historical/search?q=Acrylic&limit=20",
    "/api/historical/like-styles?yarnType=Acrylic&limit=20",
    "/api/export/requests.csv",
    "/api/export/history.csv",
    "/api/export/like-styles.csv",
  ];

  const results = {};
  for (const ep of endpoints) results[ep] = { count: 0, errors: 0, times: [] };

  const deadline = Date.now() + DURATION_MS;
  const workers = [];

  for (let i = 0; i < CONCURRENT; i++) {
    const worker = (async () => {
      while (Date.now() < deadline) {
        const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
        try {
          const res = await request(new URL(ep, BASE_URL).toString(), {
            headers: { cookie: SESSION_COOKIE }
          });
          results[ep].count++;
          results[ep].times.push(res.ms);
          if (res.status >= 500) results[ep].errors++;
        } catch {
          results[ep].errors++;
        }
      }
    })();
    workers.push(worker);
  }

  await Promise.all(workers);

  console.log("\n=== Load Test Results ===");
  let totalRequests = 0;
  let totalErrors = 0;

  for (const [ep, data] of Object.entries(results)) {
    const avg = data.times.length ? Math.round(data.times.reduce((a, b) => a + b, 0) / data.times.length) : 0;
    const max = data.times.length ? Math.max(...data.times) : 0;
    const min = data.times.length ? Math.min(...data.times) : 0;
    totalRequests += data.count;
    totalErrors += data.errors;
    console.log(`${ep}: ${data.count} req, ${data.errors} err, avg=${avg}ms, min=${min}ms, max=${max}ms`);
  }

  console.log(`\nTotal: ${totalRequests} requests, ${totalErrors} errors`);
  const errorRate = totalRequests ? ((totalErrors / totalRequests) * 100).toFixed(2) : "0.00";
  console.log(`Error rate: ${errorRate}%`);

  if (totalErrors > totalRequests * 0.05) {
    console.error("Error rate exceeded 5% threshold");
    process.exit(1);
  }

  console.log("Load test passed");
}

loadTest().catch((err) => {
  console.error(err);
  process.exit(1);
});