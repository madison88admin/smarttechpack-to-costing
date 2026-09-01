import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, readSessionPayload, verifySessionToken } from "../src/lib/auth/session";

describe("signed sessions", () => {
  const previousSecret = process.env.TP_COSTING_SESSION_SECRET;

  beforeEach(() => {
    process.env.TP_COSTING_SESSION_SECRET = "test-only-secret-with-at-least-32-characters";
  });

  afterEach(() => {
    process.env.TP_COSTING_SESSION_SECRET = previousSecret;
  });

  it("creates and verifies an authenticated identity", async () => {
    const token = await createSessionToken({ sub: "user-123", email: "user@example.com", name: "Test User", role: "costing" });
    await expect(verifySessionToken(token)).resolves.toMatchObject({ sub: "user-123", role: "costing" });
    expect(readSessionPayload(token)).toMatchObject({ email: "user@example.com" });
  });

  it("rejects a modified payload", async () => {
    const token = await createSessionToken({ sub: "user-123", email: "user@example.com", name: "Test User", role: "viewer" });
    const [payload, signature] = token.split(".");
    const tampered = `${payload.slice(0, -1)}A.${signature}`;
    await expect(verifySessionToken(tampered)).resolves.toBeNull();
  });

  it("requires a strong server secret", async () => {
    process.env.TP_COSTING_SESSION_SECRET = "short";
    await expect(createSessionToken({ sub: "u", email: "u@example.com", name: "U", role: "viewer" })).rejects.toThrow(/32 characters/);
  });
});
