import { getNextGenBaseUrl } from "./config";
import {
  getLoginBackoff,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginBackoff
} from "./login-backoff";

type CookieJar = Map<string, string>;

let cachedCookies: CookieJar | null = null;
let cachedAt = 0;

const SESSION_TTL_MS = 20 * 60 * 1000;

export function invalidateNextGenSession() {
  cachedCookies = null;
  cachedAt = 0;
}

export function isNextGenSessionCached(): boolean {
  return cachedCookies !== null && Date.now() - cachedAt < SESSION_TTL_MS;
}

export { getLoginBackoff as getNextGenLoginBackoff };
export { resetLoginBackoff as resetNextGenLoginBackoff };

function mergeSetCookie(jar: CookieJar, setCookie: string | null) {
  if (!setCookie) return;

  for (const cookie of setCookie.split(/,(?=\s*[^;=]+=[^;]+)/)) {
    const [pair] = cookie.trim().split(";");
    const index = pair.indexOf("=");

    if (index > 0) {
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
}

function serializeCookies(jar: CookieJar) {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function extractHiddenInputs(html: string) {
  const fields = new URLSearchParams();
  const inputPattern = /<input\b[^>]*>/gi;
  const namePattern = /\bname=["']([^"']+)["']/i;
  const valuePattern = /\bvalue=["']([^"']*)["']/i;

  for (const match of html.matchAll(inputPattern)) {
    const input = match[0];
    const name = input.match(namePattern)?.[1];
    const value = input.match(valuePattern)?.[1] ?? "";

    if (name) fields.set(name, value);
  }

  return fields;
}

export async function getNextGenSessionCookie() {
  if (cachedCookies && Date.now() - cachedAt < SESSION_TTL_MS) {
    return serializeCookies(cachedCookies);
  }

  // A valid cached session bypasses back-off entirely — only *fresh* logins
  // are throttled. When the window is active, refuse before any network call
  // so the app and monitors stop extending a lockout.
  const backoff = getLoginBackoff();
  if (backoff.active) {
    throw new Error(
      `NextGen login is backing off after ${backoff.failures} consecutive failures; retry in ~${backoff.retryAfterSeconds}s`
    );
  }

  const username = process.env.NEXTGEN_USERNAME;
  const password = process.env.NEXTGEN_PASSWORD;

  if (!username || !password) {
    throw new Error("NEXTGEN_USERNAME and NEXTGEN_PASSWORD are required");
  }

  try {
    return await doLogin(username, password);
  } catch (error) {
    // Treat every failed fresh login as a strike toward back-off. Credential
    // errors and network failures both count — a locked account fails login
    // even when the network is fine.
    recordLoginFailure();
    throw error;
  }
}

async function doLogin(username: string, password: string) {
  const baseUrl = getNextGenBaseUrl();
  const jar: CookieJar = new Map();

  const loginPage = await fetch(`${baseUrl}/Account/Login`, {
    method: "GET",
    cache: "no-store",
    redirect: "manual"
  });

  mergeSetCookie(jar, loginPage.headers.get("set-cookie"));

  const fields = extractHiddenInputs(await loginPage.text());
  fields.set("UserName", username);
  fields.set("Username", username);
  fields.set("Email", username);
  fields.set("Password", password);

  const loginResponse = await fetch(`${baseUrl}/Account/Login`, {
    method: "POST",
    body: fields,
    cache: "no-store",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: serializeCookies(jar)
    }
  });

  mergeSetCookie(jar, loginResponse.headers.get("set-cookie"));

  if (!jar.has("FastReactAuthentication")) {
    throw new Error(`NextGen login failed with status ${loginResponse.status}`);
  }

  cachedCookies = jar;
  cachedAt = Date.now();
  recordLoginSuccess();

  return serializeCookies(jar);
}
