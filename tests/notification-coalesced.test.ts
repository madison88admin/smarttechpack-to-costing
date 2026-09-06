import { describe, expect, it, vi } from "vitest";
import { CoalescedRunner } from "../src/lib/notifications/coalesced";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CoalescedRunner", () => {
  it("shares one in-flight fetch across concurrent callers", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const run = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    const runner = new CoalescedRunner(run);

    const first = runner.load();
    const second = runner.load();
    const third = runner.load();

    // Exactly one fetch was issued and every caller joined the same promise —
    // no duplicate in-flight requests.
    expect(run).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);

    d1.resolve("feed");
    await expect(first).resolves.toBe("feed");
    await expect(second).resolves.toBe("feed");

    // The coalesced callers marked the shared fetch dirty (they arrived while
    // it was running), so one catch-up refresh followed — concurrent callers
    // never duplicate the fetch, they only ever add that single refresh.
    expect(run).toHaveBeenCalledTimes(2);
    d2.resolve("refreshed");
    await expect(d2.promise).resolves.toBe("refreshed");
  });

  it("runs a catch-up load when a write lands during the shared fetch", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const run = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    const runner = new CoalescedRunner(run);

    // The 60s poll starts; a dismissal-triggered reload coalesces into it.
    const first = runner.load();
    const second = runner.load();
    expect(run).toHaveBeenCalledTimes(1);

    // The shared fetch settles with pre-dismissal data — stale by now.
    d1.resolve("pre-dismissal");
    await first;

    // A single catch-up fetch ran immediately with the newest server state —
    // the tray converges now, not at the next poll.
    expect(run).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);

    d2.resolve("post-dismissal");
    await second;
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not re-run when nothing coalesced during the fetch", async () => {
    const run = vi.fn().mockResolvedValue("feed");
    const runner = new CoalescedRunner(run);

    await runner.load();
    await runner.load();

    // Sequential loads with no overlap: no catch-up, one fetch each.
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("bounded catch-up: each coalesced caller re-runs at most once more", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();
    const run = vi
      .fn()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise)
      .mockReturnValueOnce(d3.promise);
    const runner = new CoalescedRunner(run);

    runner.load(); // fetch #1
    runner.load(); // coalesced → dirty
    d1.resolve("v1");
    await d1.promise;
    expect(run).toHaveBeenCalledTimes(2); // catch-up #2

    runner.load(); // coalesces into #2 → dirty again
    d2.resolve("v2");
    await d2.promise;
    expect(run).toHaveBeenCalledTimes(3); // catch-up #3 for the second caller

    d3.resolve("v3");
    await d3.promise;
    expect(run).toHaveBeenCalledTimes(3); // terminates once callers stop
  });

  it("retries after a failure and clears the coalesced state", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce("feed");
    const runner = new CoalescedRunner(run);

    await expect(runner.load()).rejects.toThrow("network down");
    await expect(runner.load()).resolves.toBe("feed");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("catches up even when the shared fetch failed mid-write", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const run = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    const runner = new CoalescedRunner(run);

    runner.load(); // fetch #1 in flight
    runner.load(); // a dismissal coalesced into it
    d1.reject(new Error("boom"));
    await d1.promise.catch(() => {});

    // The catch-up still ran — the write changed server state and the tray
    // must converge despite the failed shared fetch.
    expect(run).toHaveBeenCalledTimes(2);
    d2.resolve("fresh");
    await d2.promise;
  });
});