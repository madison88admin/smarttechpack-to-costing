// Coalesces concurrent async loads so callers never issue duplicate in-flight
// fetches.
//
// The notification bell refreshes its feed from several sources that can fire
// near-simultaneously: the 60s poll, dismissal-triggered reloads (via the
// notif-sync channel), and the panel's "Mark all read". Every concurrent caller
// shares the single in-flight fetch instead of stacking duplicate requests.
//
// The subtle case: a *write* (a dismissal recording read receipts) can land
// while an older fetch is still running. That fetch's response is stale by the
// time it arrives — the dismissed item would reappear until the next poll.
// Callers that coalesce into an in-flight fetch therefore mark it dirty, and a
// single catch-up load runs once the shared fetch settles, so the tray always
// converges immediately. `run` must return a promise (an async function).

export class CoalescedRunner<T = void> {
  private inflight: Promise<T> | null = null;
  private stale = false;

  constructor(private readonly run: () => Promise<T>) {}

  /**
   * Starts a load, or joins the one already in flight. Resolves with the shared
   * fetch's value; if the world changed while that fetch was running, a single
   * catch-up load is started when it settles.
   */
  load(): Promise<T> {
    if (this.inflight) {
      // A newer state may have landed while the shared fetch is running
      // (e.g. a dismissal wrote fresh receipts) — coalesce now, re-run after.
      this.stale = true;
      return this.inflight;
    }
    this.stale = false;
    const p = this.run();
    this.inflight = p;
    // Both settle paths handled so a rejection never becomes an unhandled
    // rejection; the settle callback decides whether a catch-up is needed.
    void p.then(
      () => this.settle(),
      () => this.settle()
    );
    return p;
  }

  private settle(): void {
    this.inflight = null;
    if (this.stale) {
      // A coalesced caller arrived mid-flight (a dismissal or mark-all-read
      // landed). Re-run once with the newest server state instead of showing
      // the stale response until the next poll. Each re-run only happens when
      // another caller coalesced during it, so the chain always terminates.
      this.stale = false;
      this.load();
    }
  }
}