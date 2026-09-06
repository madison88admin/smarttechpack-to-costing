import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("debug factory ownership (live DB)", () => {
  it("resolves the assigned factory profile through the app's own code", async () => {
    const env = readFileSync(".env.local", "utf8");
    const url = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1] ?? "";
    const key = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1] ?? "";
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;

    const { resolveFactoryProfileId, factoryOwnsRequest } = await import("../src/lib/admin/assignments");
    const pid = await resolveFactoryProfileId("3e5cd390-26a2-4ed7-b88e-097560615a2a");
    console.log("resolveFactoryProfileId →", pid);
    const owns = await factoryOwnsRequest(
      "3e5cd390-26a2-4ed7-b88e-097560615a2a",
      "26e7f66a-0b25-40f3-a678-ca108a9a5665"
    );
    console.log("factoryOwnsRequest →", owns);
    expect(owns).toBe(true);
  });
});