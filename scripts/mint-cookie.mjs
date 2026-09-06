// Mints a signed tp_costing session cookie for any role.
//
// The dev/CI servers verify the cookie with HMAC-SHA256 over the base64url
// JSON payload using TP_COSTING_SESSION_SECRET. Minting a real token lets a
// test act as any role (PBD, factory, MD, costing, admin, viewer…) without
// needing database passwords — the exact mechanism the fuzz harness uses.
//
// Usage:
//   node scripts/mint-cookie.mjs <role> <sub> <name> <email>
//
// Prints just the cookie VALUE (pair with `tp_costing_session=`), e.g.:
//   COOKIE=$(node scripts/mint-cookie.mjs pbd 3a7c8aba-… "PBD" pbd@test.local)
//   curl -H "Cookie: tp_costing_session=$COOKIE" http://localhost:3120/api/…

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const SESSION_TTL_SECONDS = 8 * 60 * 60;

function loadSecret() {
  const fromEnv = process.env.TP_COSTING_SESSION_SECRET;
  if (fromEnv) return fromEnv;
  for (const file of [".env.development.local", ".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/^TP_COSTING_SESSION_SECRET=(.+)$/m);
    if (match) return match[1].trim();
  }
  throw new Error("TP_COSTING_SESSION_SECRET not found in env or .env files");
}

const secret = loadSecret();

function b64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(payload) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function mintCookie({ sub, email, name, role }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub, email, name, role, iat: now, exp: now + SESSION_TTL_SECONDS }));
  return `${payload}.${sign(payload)}`;
}

// CLI mode only when executed directly — not when imported as a module.
const isCli = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/mint-cookie.mjs");
if (isCli) {
  const [, , role, sub, name, email] = process.argv;
  if (!role || !sub || !name || !email) {
    console.error("usage: node scripts/mint-cookie.mjs <role> <sub> <name> <email>");
    process.exit(1);
  }
  console.log(mintCookie({ sub, email, name, role }));
}