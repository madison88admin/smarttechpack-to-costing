/**
 * What a Factory user may reach, as the middleware enforces it.
 *
 * Factory sessions are confined to their own workspace: the CBD wizard, the
 * request list scoped to their assignments, and the handful of APIs those
 * screens call. This lives apart from src/middleware.ts so it can be executed
 * by a test — a path the factory UI calls but this list forgets is a 403 on a
 * control the user can see, which is how the photo panel broke.
 */

const CBD_PATHS = [
  // The CBD wizard's own endpoints: save/submit, structured change requests,
  // and the photos its upload panel loads on mount.
  /^\/api\/costing\/requests\/[0-9a-f-]+\/(cbd|change-requests|photos)$/i
];

const EXACT_API_PATHS = new Set([
  "/api/auth/logout",
  "/api/notifications/pending",
  "/api/notifications/read",
  "/api/costing/import"
]);

export function isFactoryAllowedPath(pathname: string): boolean {
  // /requests (exact) shows factory users their own assigned requests — the
  // page scopes rows to the caller's assignment. Detail pages stay on the
  // /factory/[id] CBD wizard, so /requests/* is not opened up.
  if (pathname === "/" || pathname === "/requests" || pathname.startsWith("/factory/") || pathname === "/factory") return true;
  if (/^\/requests\/[0-9a-f-]+$/i.test(pathname)) return true;
  // The CBD wizard's own page links here (side-by-side revision comparison);
  // the page scopes itself to the caller's assignment.
  if (/^\/requests\/[0-9a-f-]+\/cbd-diff$/i.test(pathname)) return true;
  if (EXACT_API_PATHS.has(pathname)) return true;
  if (CBD_PATHS.some((pattern) => pattern.test(pathname))) return true;
  if (/^\/api\/product\/[^/]+\/image$/i.test(pathname)) return true;
  return false;
}
