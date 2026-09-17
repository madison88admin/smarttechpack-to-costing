import { afterEach, beforeEach } from "vitest";
import { liveUpstreamEnabled } from "../helpers/live-upstream";

// Unit tests must not depend on the network. A page render that reaches the live
// NextGen ERP is not deterministic: it passes while the ERP answers and fails
// whenever the upstream is slow, because the reader allows an 8s attempt plus
// 1s+2s backoff — well past the 5s default test timeout. The failure is also
// invisible when the caller swallows upstream errors (`tryGetNextGenFilterOptions`
// catches and returns an empty directory), so the test quietly stops proving
// anything about the code under test.
//
// This records the attempt and fails the test in `afterEach` rather than only
// throwing at the call site: a throw would be caught by exactly that
// swallow-handler and pass. Loopback stays allowed so tests that drive a local
// server still work, a test that installs its own `fetch` stub replaces this
// wrapper entirely, and suites whose subject really is a live service opt in
// through the one switch the drivers use.

const realFetch = globalThis.fetch.bind(globalThis);
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)([:/]|$)/i;

let violations: string[] = [];

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url ?? input);
  if (!liveUpstreamEnabled() && !LOOPBACK.test(url)) {
    violations.push(`${init?.method ?? "GET"} ${url}`);
    throw new Error(`outbound network is blocked in unit tests: ${url}`);
  }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

beforeEach(() => {
  violations = [];
});

afterEach(() => {
  const seen = violations;
  violations = [];
  if (seen.length) {
    throw new Error(
      `unit test made ${seen.length} real outbound request(s):\n  ${seen.join("\n  ")}\n` +
        `Mock the module that fetches (see tests/helpers/), or if this suite's subject really is a\n` +
        `live service, gate it with liveUpstreamEnabled() from tests/helpers/live-upstream.`
    );
  }
});
