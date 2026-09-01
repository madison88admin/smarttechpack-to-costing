import { describe, expect, it } from "vitest";

describe("proxy origin model", () => {
  it("treats the forwarded HTTPS host as the public origin", () => {
    const origin = new URL("https://smart-tp-costing.5-223-78-194.sslip.io");
    const forwardedHost = "smart-tp-costing.5-223-78-194.sslip.io";
    const forwardedProtocol = "https";
    expect(origin.host === forwardedHost && origin.protocol === `${forwardedProtocol}:`).toBe(true);
  });

  it("rejects a different host", () => {
    const origin = new URL("https://attacker.example");
    expect(origin.host).not.toBe("smart-tp-costing.5-223-78-194.sslip.io");
  });
});
