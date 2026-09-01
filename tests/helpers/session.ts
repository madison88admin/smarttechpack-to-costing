import { createSessionToken } from "../../src/lib/auth/session";
import type { UserRole } from "../../src/lib/auth/roles";

const TEST_SECRET = "test-only-secret-with-at-least-32-characters";

/**
 * Issues a real signed session token for the given role, for route-level tests
 * that exercise the auth stack (getCurrentRole and friends) end to end. The
 * test file must mock `next/headers` cookies to hand the token back.
 */
export async function issueSessionToken(role: UserRole): Promise<string> {
  process.env.TP_COSTING_SESSION_SECRET = TEST_SECRET;
  return createSessionToken({
    sub: `u-${role}`,
    email: `${role}@example.com`,
    name: role,
    role
  });
}
