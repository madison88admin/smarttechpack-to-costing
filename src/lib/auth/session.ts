import type { UserRole } from "./roles";

export const SESSION_COOKIE = "tp_costing_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type SessionIdentity = {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  iat: number;
  exp: number;
};

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function encodeBytes(bytes: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signature(payload: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return encodeBytes(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function getSessionSecret() {
  const secret = process.env.TP_COSTING_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("TP_COSTING_SESSION_SECRET must contain at least 32 characters");
  return secret;
}

export async function createSessionToken(identity: Omit<SessionIdentity, "iat" | "exp">) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(JSON.stringify({ ...identity, iat: now, exp: now + SESSION_TTL_SECONDS } satisfies SessionIdentity));
  return `${payload}.${await signature(payload, getSessionSecret())}`;
}

export async function verifySessionToken(token?: string | null): Promise<SessionIdentity | null> {
  if (!token) return null;
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  try {
    if (!constantTimeEqual(suppliedSignature, await signature(payload, getSessionSecret()))) return null;
    const session = JSON.parse(base64UrlDecode(payload)) as SessionIdentity;
    if (!session.sub || !session.email || !session.name || !session.role || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export function readSessionPayload(token?: string | null): SessionIdentity | null {
  if (!token) return null;
  try {
    const [payload] = token.split(".");
    if (!payload) return null;
    const session = JSON.parse(base64UrlDecode(payload)) as SessionIdentity;
    return session.exp > Math.floor(Date.now() / 1000) ? session : null;
  } catch {
    return null;
  }
}
