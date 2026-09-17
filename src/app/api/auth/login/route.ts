import { NextResponse } from "next/server";
import type { UserRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pgrestValue } from "@/lib/supabase/filters";
import { verifyPassword } from "@/lib/auth/passwords";
import { createSupabaseAuthClient, isSupabaseAuthEnabled } from "@/lib/auth/supabase-auth";
import { getClientIp, isRateLimited, RATE_LIMITS, recordRateLimitHit, resetRateLimit } from "@/lib/auth/rate-limit";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";

const validRoles = new Set<UserRole>(["superadmin", "admin", "manager", "pbd", "costing", "factory", "md", "viewer"]);

function findPilotUser(username: string, password: string) {
  if (process.env.TP_COSTING_ENABLE_PILOT_LOGIN !== "true") return null;
  let pilotUsers: Record<string, { password: string; role: UserRole; name: string; email?: string }> = {};
  try {
    pilotUsers = JSON.parse(process.env.TP_COSTING_PILOT_USERS_JSON ?? "{}") as typeof pilotUsers;
  } catch {
    return null;
  }
  // Keep the local pilot usable even when a JSON env value is not loaded by a
  // process manager; production deployments still require the explicit env
  // flag above and should provide TP_COSTING_PILOT_USERS_JSON.
  const pilot = pilotUsers[username] ?? (process.env.NODE_ENV !== "production" && username === "admin@madison88.com"
    ? { password: "test", role: "admin" as UserRole, name: "Admin User", email: username }
    : process.env.NODE_ENV !== "production" && username === "superadmin@madison88.com"
      ? { password: "test", role: "superadmin" as UserRole, name: "Super Admin", email: username }
      : undefined);
  if (!pilot || !validRoles.has(pilot.role)) return null;
  if (pilot.password !== password) return null;
  return {
    id: `pilot-${username}`,
    role: pilot.role,
    name: pilot.name,
    email: pilot.email ?? `${username}@pilot.local`
  };
}

async function findProfileUser(username: string, password: string) {
  if (process.env.TP_COSTING_ENABLE_LEGACY_PASSWORD_LOGIN !== "true" || !username.includes("@")) return null;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id,display_name,email,role,is_active,password_hash")
    .eq("email", pgrestValue(username))
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;

  const role = String(data.role).toLowerCase() as UserRole;
  if (!validRoles.has(role)) return null;
  const validPassword = verifyPassword(password, typeof data.password_hash === "string" ? data.password_hash : null);

  if (!validPassword) return null;

  await supabase.from("user_profiles").update({ last_login_at: new Date().toISOString() }).eq("id", data.id);

  return {
    id: String(data.id),
    role,
    name: String(data.display_name ?? username),
    email: String(data.email ?? username)
  };
}

async function findSupabaseAuthUser(username: string, password: string) {
  if (!isSupabaseAuthEnabled() || !username.includes("@")) return null;

  const authClient = createSupabaseAuthClient();
  if (!authClient) return null;

  const { data, error } = await authClient.auth.signInWithPassword({
    email: username,
    password
  });

  if (error || !data.user) return null;

  const supabase = createSupabaseServiceClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id,display_name,email,role,is_active")
    .eq("email", pgrestValue(username))
    .eq("is_active", true)
    .maybeSingle();

  if (!profile) {
    await authClient.auth.signOut();
    return null;
  }

  const role = String(profile.role).toLowerCase() as UserRole;

  await supabase.from("user_profiles").update({ last_login_at: new Date().toISOString(), auth_user_id: data.user.id }).eq("id", profile.id);

  return {
    id: String(data.user.id),
    role: validRoles.has(role) ? role : "viewer",
    name: String(profile.display_name ?? data.user.email ?? username),
    email: String(profile.email ?? data.user.email ?? username)
  };
}

export async function POST(request: Request) {
  // Rate limit: 5 FAILED login attempts per 15 minutes per IP. Successful
  // logins must never consume quota (they reset the window), otherwise a
  // legit user — or the smoke suite — gets locked out by its own successes.
  const clientIp = getClientIp(request);
  const rateLimitKey = `login:${clientIp}`;
  if (isRateLimited(rateLimitKey, RATE_LIMITS.login.maxRequests, RATE_LIMITS.login.windowMs)) {
    return NextResponse.json(
      { ok: false, error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }

  const body = await request.json().catch(() => null);
  const username = String(body?.username ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const user = (await findSupabaseAuthUser(username, password)) ?? (await findProfileUser(username, password)) ?? findPilotUser(username, password);

  if (!user) {
    recordRateLimitHit(rateLimitKey, RATE_LIMITS.login.maxRequests, RATE_LIMITS.login.windowMs);
    return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
  }

  // Successful auth clears the failure window for this IP.
  resetRateLimit(rateLimitKey);

  const response = NextResponse.json({ ok: true, role: user.role, name: user.name, email: user.email ?? null });
  const isProduction = process.env.NODE_ENV === "production";
  const sessionToken = await createSessionToken({
    sub: user.id,
    email: user.email ?? username,
    name: user.name,
    role: user.role
  });
  response.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });

  return response;
}
