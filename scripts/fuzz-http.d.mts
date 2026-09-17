export const SESSION_COOKIE: string;

export const HOSTILE_TEXT: string[];
export const HOSTILE_NUMERIC: string[];
export const NUMERIC_PARAMS: Set<string>;

export type EndpointSpec = {
  path: string;
  role: string;
  params: string[];
  /** Statuses that count as graceful for upstream-proxy endpoints (502/503/504). */
  allow?: number[];
  /** Upstream-proxy endpoints get a longer per-request budget (NextGen is legitimately slow). */
  slow?: boolean;
  /** Endpoints proxying an external upstream — skipped when run with --skip-upstream (CI). */
  requiresUpstream?: boolean;
};

export const ENDPOINTS: EndpointSpec[];

export function mintToken(secret: string, role: string): string;

/**
 * Real HS256 JWT (header.payload.signature) for PostgREST, which rejects the
 * 2-part mintToken cookie format. Used as the CI service-role key.
 */
export function mintJwt(secret: string, role: string, ttlSeconds?: number): string;

export type ProbeSpec = {
  url: string;
  label: string;
  token: string | null;
  timeoutMs: number;
  allow?: number[];
};

export function buildProbes(base: string, endpoints: EndpointSpec[], token: string | null, timeoutMs: number): ProbeSpec[];

export function runFuzz(options?: {
  base?: string;
  secret?: string;
  role?: string;
  /** One authenticated pass per role, plus the unauthenticated pass. */
  roles?: string[];
  /** Skip upstream-proxy endpoints (no NextGen reachable in CI). */
  skipUpstream?: boolean;
  timeoutMs?: number;
  concurrency?: number;
}): Promise<boolean>;