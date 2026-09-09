/**
 * Simple in-memory rate limiter for API endpoints.
 * Tracks requests per IP address within a sliding window.
 *
 * For production, consider using Redis or a dedicated rate limiting service.
 */

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

/**
 * Check if a request should be rate limited.
 * @param identifier - IP address or user identifier
 * @param maxRequests - Maximum requests in the window
 * @param windowMs - Time window in milliseconds
 * @returns RateLimitResult indicating if request is allowed
 */
export function checkRateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  cleanup();

  const now = Date.now();
  const key = identifier;
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // New window
    const newEntry: RateLimitEntry = {
      count: 1,
      resetAt: now + windowMs
    };
    store.set(key, newEntry);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: newEntry.resetAt
    };
  }

  entry.count++;

  if (entry.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt
    };
  }

  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetAt: entry.resetAt
  };
}

/**
 * Check whether a key is currently blocked WITHOUT incrementing the counter.
 * Use for endpoints where only failures should consume quota (login): peek,
 * then recordRateLimitHit on failure / resetRateLimit on success.
 */
export function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  cleanup();
  const entry = store.get(key);
  return entry !== undefined && entry.resetAt >= Date.now() && entry.count >= maxRequests;
}

/** Increment the failure counter for a key (must follow isRateLimited). */
export function recordRateLimitHit(key: string, maxRequests: number, windowMs: number): void {
  cleanup();
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count++;
  }
}

/** Clear the counter for a key — used on successful auth so legit users and
 * automated smoke suites are never locked out by their own successes. */
export function resetRateLimit(key: string): void {
  store.delete(key);
}

/**
 * Get client IP from request headers.
 * Handles X-Forwarded-For and X-Real-IP headers.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "unknown";
}

/**
 * Rate limit configuration presets.
 */
export const RATE_LIMITS = {
  // Login: 5 attempts per 15 minutes per IP
  login: { maxRequests: 5, windowMs: 15 * 60 * 1000 },
  // AI endpoints: 20 requests per minute per IP
  ai: { maxRequests: 20, windowMs: 60 * 1000 },
  // General API: 100 requests per minute per IP
  general: { maxRequests: 100, windowMs: 60 * 1000 }
} as const;
