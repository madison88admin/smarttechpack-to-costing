import { getNextGenBaseUrl, nextGenEndpoints, type NextGenEndpointKey } from "./config";
import { getNextGenSessionCookie, invalidateNextGenSession } from "./session";

type RequestPayload = Record<string, string | number | boolean | undefined>;

// Timeout for NextGen API calls (default 30 seconds)
const NEXTGEN_TIMEOUT_MS = Number(process.env.NEXTGEN_TIMEOUT_MS ?? 30000);

// Max retries for non-401 errors (5xx, network failures)
const MAX_RETRIES = Number(process.env.NEXTGEN_MAX_RETRIES ?? 2);

// Retry delay in ms (exponential backoff: 1s, 2s, 4s)
function retryDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 4000);
}

function fetchWithTimeout(url: string | URL, options: RequestInit, timeoutMs: number = NEXTGEN_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url as URL, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

// Simple in-memory cache for GET responses (TTL in ms, default 5 minutes)
const CACHE_TTL_MS = Number(process.env.NEXTGEN_CACHE_TTL_MS ?? 5 * 60 * 1000);
const responseCache = new Map<string, { body: unknown; expiresAt: number }>();

function getCachedResponse(key: string): unknown | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.body;
}

function setCachedResponse(key: string, body: unknown): void {
  responseCache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS });
}

function toFormData(payload: RequestPayload) {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) body.set(key, String(value));
  }

  return body;
}

export function kendoSearchPayload(query: string, fieldCandidates: string[] = []) {
  const payload: RequestPayload = {
    take: 20,
    skip: 0,
    page: 1,
    pageSize: 20,
    "filter[logic]": "or"
  };

  const fields = fieldCandidates.length
    ? fieldCandidates
    : ["Name", "StyleNumber", "Code", "Number", "Description"];

  fields.forEach((field, index) => {
    payload[`filter[filters][${index}][field]`] = field;
    payload[`filter[filters][${index}][operator]`] = "contains";
    payload[`filter[filters][${index}][value]`] = query;
  });

  return payload;
}

export function legacyKendoSearchPayload(query: string, field = "Name") {
  return {
    take: 20,
    skip: 0,
    page: 1,
    pageSize: 20,
    filter: `${field}~contains~'${query.replace(/'/g, "''")}'`
  };
}

export async function nextGenPost(endpoint: NextGenEndpointKey, payload: RequestPayload) {
  // Retry on 401 (session expired) and 5xx/network errors
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await doNextGenPost(endpoint, payload);

    if (result.status === 401 && attempt === 0) {
      invalidateNextGenSession();
      continue; // Retry once after session refresh
    }

    if (isRetryableStatus(result.status) && attempt < MAX_RETRIES) {
      await sleep(retryDelay(attempt));
      continue;
    }

    return result;
  }

  // Fallback (should not reach here, but TypeScript needs it)
  return doNextGenPost(endpoint, payload);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function doNextGenPost(endpoint: NextGenEndpointKey, payload: RequestPayload) {
  const response = await fetchWithTimeout(`${getNextGenBaseUrl()}${nextGenEndpoints[endpoint]}`, {
    method: "POST",
    body: toFormData(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: await getNextGenSessionCookie()
    }
  });

  return parseNextGenResponse(response);
}

export async function nextGenGet(endpoint: NextGenEndpointKey, params: RequestPayload) {
  // Check cache first for GET requests
  const cacheKey = `get:${endpoint}:${JSON.stringify(params)}`;
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    return { ok: true, status: 200, upstreamContentType: "application/json", body: cached };
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await doNextGenGet(endpoint, params);

    if (result.status === 401 && attempt === 0) {
      invalidateNextGenSession();
      continue;
    }

    if (isRetryableStatus(result.status) && attempt < MAX_RETRIES) {
      await sleep(retryDelay(attempt));
      continue;
    }

    // Cache successful responses
    if (result.ok) {
      setCachedResponse(cacheKey, result.body);
    }

    return result;
  }

  return doNextGenGet(endpoint, params);
}

async function doNextGenGet(endpoint: NextGenEndpointKey, params: RequestPayload) {
  const url = new URL(`${getNextGenBaseUrl()}${nextGenEndpoints[endpoint]}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetchWithTimeout(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Cookie: await getNextGenSessionCookie()
    }
  });

  return parseNextGenResponse(response);
}

export async function nextGenRawGet(path: string, params: RequestPayload = {}) {
  const url = new URL(`${getNextGenBaseUrl()}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetchWithTimeout(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Cookie: await getNextGenSessionCookie()
    }
  });

  return {
    ok: response.ok,
    status: response.status,
    upstreamContentType: response.headers.get("content-type") ?? "",
    body: await response.text()
  };
}

async function parseNextGenResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      upstreamContentType: contentType,
      body
    };
  }

  return {
    ok: true,
    status: response.status,
    upstreamContentType: contentType,
    body
  };
}

// In-memory cache for product images (TTL 10 minutes)
const IMAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const imageCache = new Map<string, { buffer: Buffer; contentType: string; expiresAt: number }>();

function detectImageContentType(buffer: Buffer, upstreamContentType: string) {
  // NextGen occasionally labels PNG bytes as image/jpeg. Prefer the file
  // signature so the browser receives a truthful MIME type.
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }
  if (buffer.length >= 6 && (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return "image/gif";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return upstreamContentType.toLowerCase().split(";")[0] || "application/octet-stream";
}

/**
 * Result of fetching a product image. The union lets callers tell a genuinely
 * missing image (not-found) apart from upstream problems (NextGen login
 * failing, NextGen not configured, or the endpoint itself erroring), so a
 * credential failure can never masquerade as "Image not found".
 */
export type ProductImageResult =
  | { ok: true; buffer: Buffer; contentType: string }
  | { ok: false; reason: "not-found"; detail?: string }
  | { ok: false; reason: "login-failed"; detail: string }
  | { ok: false; reason: "not-configured"; detail: string }
  | { ok: false; reason: "upstream"; detail: string };

/**
 * Fetch a product image from NextGen by entity ID.
 * Tries the /Product/GetImage/{entityId} endpoint using the authenticated session.
 * Returns a ProductImageResult; the real cause of every failure is logged
 * server-side (entity id + upstream detail) before it is surfaced.
 */
export async function fetchProductImage(entityId: string): Promise<ProductImageResult> {
  // Check cache first
  const cached = imageCache.get(entityId);
  if (cached && Date.now() < cached.expiresAt) {
    return { ok: true, buffer: cached.buffer, contentType: cached.contentType };
  }

  let baseUrl: string;
  try {
    baseUrl = getNextGenBaseUrl();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "NEXTGEN_BASE_URL is not configured";
    console.error(`[nextgen] product image ${entityId}: NextGen not configured — ${detail}`);
    return { ok: false, reason: "not-configured", detail };
  }

  // NextGen image URL patterns (found from JS bundle analysis):
  // - Document/FirstTumbnailForEntity/5/{entityId} → first thumbnail for product (entityType=5)
  // - Document/Image/{entityId} → main product image (full size, but can return wrong/placeholder for some products)
  // The NextGen session is cached for 20 minutes. If it expires upstream, the
  // image endpoints respond with a 302/401 instead of an image. Refresh once
  // and retry so the UI does not show a false "Image not found" state.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let cookie: string;
    try {
      cookie = await getNextGenSessionCookie();
    } catch (error) {
      const message = error instanceof Error ? error.message : "NextGen session unavailable";
      // Missing configuration is a deployment problem; a rejected login is an
      // upstream credentials problem. Both are logged and surfaced distinctly.
      if (message.includes("are required") || message.includes("is not configured")) {
        console.error(`[nextgen] product image ${entityId}: NextGen not configured — ${message}`);
        return { ok: false, reason: "not-configured", detail: message };
      }
      console.error(`[nextgen] product image ${entityId}: NextGen login failed — ${message}`);
      return { ok: false, reason: "login-failed", detail: message };
    }

    let sessionRejected = false;
    let sawHttpResponse = false;
    let lastUpstreamError: string | null = null;
    const cacheBust = Date.now();
    const candidatePaths = [
      `/Document/FirstTumbnailForEntity/5/${entityId}?t=${cacheBust}`,
      `/Document/Image/${entityId}?t=${cacheBust}`
    ];

    for (const path of candidatePaths) {
      try {
        const response = await fetchWithTimeout(
          `${baseUrl}${path}`,
          {
            method: "GET",
            cache: "no-store",
            redirect: "manual",
            headers: {
              Cookie: cookie
            }
          },
          15000
        );
        sawHttpResponse = true;

        if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) {
          sessionRejected = true;
          continue;
        }

        if (!response.ok) continue;

        const contentType = response.headers.get("content-type") ?? "";
        // Accept image responses (NextGen returns "Image/png" or "image/jpeg" with varying case)
        if (!/image\//i.test(contentType)) continue;

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length === 0) continue;
        // Skip tiny placeholder/error bodies while retaining legitimate small thumbnails.
        if (buffer.length < 1000) continue;

        // Normalize content type and correct any upstream MIME mismatch.
        const normalizedContentType = detectImageContentType(buffer, contentType);

        // Cache the result
        imageCache.set(entityId, {
          buffer,
          contentType: normalizedContentType,
          expiresAt: Date.now() + IMAGE_CACHE_TTL_MS
        });

        return { ok: true, buffer, contentType: normalizedContentType };
      } catch (error) {
        // Network/timeout failure — remember it in case no candidate responds.
        lastUpstreamError = error instanceof Error ? error.message : "network error";
        continue;
      }
    }

    if (sessionRejected && attempt === 0) {
      invalidateNextGenSession();
      continue; // retry once with a freshly logged-in session
    }

    if (sessionRejected) {
      // Even a freshly refreshed session is rejected by the image endpoints:
      // this is an auth problem, not a missing image.
      const detail = "NextGen session was rejected by the image endpoints even after a fresh login";
      console.error(`[nextgen] product image ${entityId}: NextGen login failed — ${detail}`);
      return { ok: false, reason: "login-failed", detail };
    }

    if (!sawHttpResponse && lastUpstreamError) {
      console.error(`[nextgen] product image ${entityId}: NextGen upstream error — ${lastUpstreamError}`);
      return { ok: false, reason: "upstream", detail: lastUpstreamError };
    }

    break;
  }

  console.warn(`[nextgen] product image ${entityId}: not found (no candidate endpoint returned an image)`);
  return { ok: false, reason: "not-found" };
}
