import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

const publicPaths = ["/login", "/api/auth/login", "/api/health"];
const cronPaths = new Set([
  "/api/notifications/escalate",
  "/api/notifications/process",
  "/api/notifications/daily-digest",
  "/api/admin/check-bom-versions",
  "/api/admin/backfill-nextgen-times",
  "/api/admin/refresh-nextgen-metadata"
]);
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function isPublicPath(pathname: string) {
  return publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return false;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const expectedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
    const expectedProtocol = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "")).split(",")[0].trim();
    return originUrl.host === expectedHost && originUrl.protocol === `${expectedProtocol}:`;
  } catch {
    return false;
  }
}

function isFactoryAllowedPath(pathname: string) {
  if (pathname === "/" || pathname.startsWith("/factory/") || pathname === "/factory") return true;
  if (/^\/requests\/[0-9a-f-]+$/i.test(pathname)) return true;
  if (pathname === "/api/auth/logout" || pathname === "/api/notifications/pending" || pathname === "/api/costing/import") return true;
  if (/^\/api\/costing\/requests\/[0-9a-f-]+\/cbd$/i.test(pathname)) return true;
  if (/^\/api\/product\/[^/]+\/image$/i.test(pathname)) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const suppliedCronSecret = request.headers.get("x-cron-secret");
  const expectedCronSecret = process.env.CRON_SECRET;
  const cronAuthorized = cronPaths.has(pathname) && Boolean(expectedCronSecret) && suppliedCronSecret === expectedCronSecret;
  if (cronAuthorized) return NextResponse.next();
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (pathname === "/login" && session) return NextResponse.redirect(new URL("/", request.url));
  if (!isPublicPath(pathname) && !session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (session?.role === "factory" && !isFactoryAllowedPath(pathname)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "Factory access is restricted" }, { status: 403 });
    return NextResponse.redirect(new URL("/factory", request.url));
  }
  if (pathname.startsWith("/api/") && !safeMethods.has(request.method) && !isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Cross-site request rejected" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
