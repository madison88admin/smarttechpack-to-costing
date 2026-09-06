#!/usr/bin/env node
// Minimal /rest/v1 → PostgREST path proxy used by the CI fuzz boot
// (scripts/ci-fuzz-boot.sh). supabase-js always calls "<base>/rest/v1/<table>"
// (verified: `new URL("rest/v1", baseUrl)` in @supabase/supabase-js), while a
// bare PostgREST serves at the root — so strip the /rest/v1 prefix and forward
// everything else untouched (method, headers incl. Authorization/Accept-Profile,
// and body).
//
//   POSTGREST_UPSTREAM=http://127.0.0.1:3000 PORT=3100 node scripts/ci-rest-proxy.mjs

import { createServer, request } from "node:http";

const PORT = Number(process.env.PORT ?? 3100);
const UPSTREAM = new URL(process.env.POSTGREST_UPSTREAM ?? "http://127.0.0.1:3000");

const server = createServer((req, res) => {
  const path = req.url?.startsWith("/rest/v1") ? req.url.slice("/rest/v1".length) || "/" : req.url ?? "/";
  const upstreamReq = request(
    {
      protocol: UPSTREAM.protocol,
      hostname: UPSTREAM.hostname,
      port: UPSTREAM.port || (UPSTREAM.protocol === "https:" ? 443 : 80),
      method: req.method,
      path,
      headers: { ...req.headers, host: `${UPSTREAM.hostname}:${UPSTREAM.port || 80}` }
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    }
  );
  upstreamReq.on("error", (err) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`upstream error: ${err.message}`);
  });
  req.pipe(upstreamReq);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`rest proxy listening on 127.0.0.1:${PORT} -> ${UPSTREAM.href}`);
});
