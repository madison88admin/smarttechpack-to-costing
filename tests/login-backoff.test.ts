import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backoffStepMs,
  getLoginBackoff,
  isLoginBackedOff,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginBackoff
} from "../src/lib/nextgen/login-backoff";

const T0 = 1_700_000_000_000;

describe("login back-off state machine", () => {
  beforeEach(() => resetLoginBackoff());
  afterEach(() => resetLoginBackoff());

  it("grows the back-off window exponentially, capped at 15m", () => {
    expect(backoffStepMs(1)).toBe(30_000);
    expect(backoffStepMs(2)).toBe(60_000);
    expect(backoffStepMs(3)).toBe(120_000);
    expect(backoffStepMs(4)).toBe(240_000);
    expect(backoffStepMs(6)).toBe(900_000);
    expect(backoffStepMs(20)).toBe(900_000); // cap
    expect(backoffStepMs(0)).toBe(0);
  });

  it("allows the first failure without backing off, then blocks", () => {
    recordLoginFailure(T0);
    expect(isLoginBackedOff(T0)).toBe(false);

    recordLoginFailure(T0);
    expect(isLoginBackedOff(T0)).toBe(true);
    expect(getLoginBackoff(T0).active).toBe(true);
    expect(getLoginBackoff(T0).failures).toBe(2);
    expect(getLoginBackoff(T0).retryAfterSeconds).toBe(60);
  });

  it("clears the window after it expires", () => {
    recordLoginFailure(T0);
    recordLoginFailure(T0); // window until T0 + 60s
    expect(isLoginBackedOff(T0 + 59_000)).toBe(true);
    expect(isLoginBackedOff(T0 + 61_000)).toBe(false);
    expect(getLoginBackoff(T0 + 61_000).active).toBe(false);
  });

  it("resets on success", () => {
    recordLoginFailure(T0);
    recordLoginFailure(T0);
    recordLoginSuccess();
    expect(getLoginBackoff(T0).failures).toBe(0);
    expect(isLoginBackedOff(T0)).toBe(false);
  });

  it("extends the window when failures continue after expiry", () => {
    recordLoginFailure(T0);
    recordLoginFailure(T0);
    // window expired, another failure happens
    recordLoginFailure(T0 + 120_000);
    expect(getLoginBackoff(T0 + 120_000).failures).toBe(3);
    expect(getLoginBackoff(T0 + 120_000).retryAfterSeconds).toBe(120);
  });
});
