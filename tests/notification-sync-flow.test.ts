import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTIF_SYNC_EVENT,
  dispatchNotifSync,
  subscribeNotifSync
} from "../src/lib/notifications/sync";
import { requestIdFromNotificationKey } from "../src/lib/notifications/keys";

const REQ_A = "11111111-1111-4111-8111-111111111111";
const REQ_B = "22222222-2222-4222-8222-222222222222";
const UPDATED = "2026-08-05T14:00:00Z";
const VERSION = Math.floor(new Date(UPDATED).getTime() / 1000);

const REVIEW_KEY_A = `review-for_pbd_review-${VERSION}-${REQ_A}`;
const OVERDUE_KEY_B = `overdue-${VERSION}-${REQ_B}`;

type InAppAlert = { id: string; costingRequestId: string; alertType: string; title: string };

// Minimal DOM shim — the repo has no jsdom/testing-library, and Node's global
// EventTarget already provides the three methods (addEventListener /
// removeEventListener / dispatchEvent) the shared sync wiring needs. The rig and
// the components run identical code, so the test cannot drift from the UI.
class WindowShim extends EventTarget {}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/**
 * A client-side rig for the notif-sync channel. Mirrors the real server
 * semantics for the three endpoints the bell and panel hit:
 *  - POST /api/notifications/read  → marks feed keys read AND clears in-app
 *    alerts for the same request ids (exactly what the production route does)
 *  - GET  /api/notifications/pending → feed minus dismissed keys
 *  - GET  /api/notifications/in-app  → alerts minus cleared requests
 */
// Shared "server" — one instance per simulated backend. The read-receipt store
// and every endpoint the bell/panel hit live here, so two rigs built on the
// same server share durable state exactly like two browser windows sharing one
// backend, while each rig keeps its own window (separate EventTarget) so no
// notif-sync event ever crosses between them.
function createFakeServer() {
  const feed: Array<{ key: string }> = [{ key: REVIEW_KEY_A }, { key: OVERDUE_KEY_B }];
  const inApp: InAppAlert[] = [
    { id: "a1", costingRequestId: REQ_A, alertType: "bom_changed", title: "BOM changed" },
    { id: "a2", costingRequestId: REQ_A, alertType: "role_change", title: "Action needed" },
    { id: "a3", costingRequestId: REQ_B, alertType: "pbd_pricing_updated", title: "Pricing update" }
  ];
  const readReceipts = new Set<string>();
  const clearedRequestIds = new Set<string>();
  // When true, the next read POST fails (500) without touching any server
  // state — simulates a network/write failure for the retry affordance test.
  let failNextRead = false;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/notifications/read") {
      if (failNextRead) {
        failNextRead = false;
        return jsonResponse({ ok: false, updated: 0, inAppUpdated: 0 });
      }
      const { keys } = JSON.parse(String(init?.body ?? "{}")) as { keys: string[] };
      keys.forEach((key) => readReceipts.add(key));
      const requestIds = [
        ...new Set(keys.map((key) => requestIdFromNotificationKey(key)).filter((id): id is string => !!id))
      ];
      requestIds.forEach((id) => clearedRequestIds.add(id));
      return jsonResponse({ ok: true, updated: keys.length, inAppUpdated: requestIds.length });
    }
    if (url === "/api/notifications/in-app/read") {
      const requestIds = inApp.map((a) => a.costingRequestId);
      requestIds.forEach((id) => clearedRequestIds.add(id));
      // The real in-app read route also records bell receipts for the same
      // requests, so the bell stops nagging about them too.
      feed.forEach((n) => {
        const id = requestIdFromNotificationKey(n.key);
        if (id && requestIds.includes(id)) readReceipts.add(n.key);
      });
      return jsonResponse({ ok: true, updated: inApp.length });
    }
    if (url === "/api/notifications/pending") {
      const visible = feed.filter((n) => !readReceipts.has(n.key));
      return jsonResponse({ ok: true, notifications: visible, totalUnread: visible.length });
    }
    if (url === "/api/notifications/in-app") {
      const visible = inApp.filter((a) => !clearedRequestIds.has(a.costingRequestId));
      return jsonResponse({ ok: true, alerts: visible });
    }
    return jsonResponse({ ok: false });
  });

  return {
    fetchMock,
    readReceipts: () => readReceipts,
    failNextRead: () => {
      failNextRead = true;
    }
  };
}

type FakeServer = ReturnType<typeof createFakeServer>;

function createRig(server: FakeServer = createFakeServer()) {
  const win = new WindowShim();
  const { fetchMock } = server;

  // Subscriber handlers are async (they fetch and then update state), and the
  // event dispatch fires them synchronously — so without flushing, the test's
  // own await can race ahead of a handler's fetch→assign microtasks. The rig
  // tracks every handler promise and flushes them before the simulated
  // dismiss resolves, the way a React re-render settles before the next click.
  const activeHandlers = new Set<Promise<void>>();
  function subscribeTracked(handler: () => void | Promise<void>): () => void {
    return subscribeNotifSync(win, () => {
      const result = handler();
      if (result && typeof (result as Promise<void>).then === "function") {
        const p = (result as Promise<void>).catch(() => {});
        activeHandlers.add(p);
        void p.finally(() => activeHandlers.delete(p));
      }
    });
  }
  async function flush() {
    while (activeHandlers.size > 0) {
      await Promise.all([...activeHandlers]);
    }
  }

  // Panel side — the exact wiring ChangeAlertsPanel runs: subscribe to the
  // channel and refetch the in-app list on every announcement.
  let alerts: InAppAlert[] = [];
  let panelRefetches = 0;
  const loadPanel = async () => {
    panelRefetches += 1;
    const data = await (await fetchMock("/api/notifications/in-app")).json();
    if (data.ok) alerts = data.alerts ?? [];
  };
  const unsubscribePanel = subscribeTracked(loadPanel);

  // Bell side — the wiring NotificationBell runs: the feed response is the
  // single source of truth (no local hide state), and the bell reloads it both
  // on mount and whenever the channel announces a read-state change, so a
  // dismissal converges in one roundtrip instead of waiting for the 60s poll.
  let bellFeed: Array<{ key: string }> = [];
  let bellRefetches = 0;
  const loadBell = async () => {
    bellRefetches += 1;
    const data = await (await fetchMock("/api/notifications/pending")).json();
    if (data.ok) bellFeed = data.notifications ?? [];
  };
  subscribeTracked(loadBell);

  // The components load on mount — tests call this once to mirror that.
  const init = async () => {
    await loadPanel();
    await loadBell();
  };

  return {
    win,
    fetchMock,
    // Simulate the bell's dismissOne: POST the read receipts, and announce only
    // if the server accepted them — exactly the new component flow, with the
    // server as source of truth and no announce on a failed write.
    bellDismiss: async (keys: string[]) => {
      const res = await fetchMock("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys })
      });
      const data = await res.json();
      if (data.ok) {
        dispatchNotifSync(win);
        await flush();
      }
    },
    // Toggle: the next read POST fails instead of recording receipts.
    failNextRead: server.failNextRead,
    // Any load trigger on this window (a new tab opening, a reload, or the
    // eventual 60s poll) — used to prove cross-window convergence happens on
    // the next fetch, not on a specific poll tick.
    bellRefresh: async () => {
      await loadBell();
    },
    // Simulate the panel's "Mark all read": clear everything server-side, then announce.
    panelMarkAllRead: async () => {
      await fetchMock("/api/notifications/in-app/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      dispatchNotifSync(win);
      await flush();
    },
    init,
    panelAlerts: () => alerts,
    panelBadge: () => alerts.length,
    panelRefetches: () => panelRefetches,
    bellKeys: () => bellFeed.map((n) => n.key),
    bellRefetches: () => bellRefetches,
    unsubscribePanel
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("notif-sync channel contract", () => {
  it("reaches subscribers through the shared constant, and only that event name", () => {
    const win = new WindowShim();
    const handler = vi.fn();
    const wrongName = vi.fn();
    subscribeNotifSync(win, handler);
    win.addEventListener("other-event", wrongName);

    dispatchNotifSync(win);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(wrongName).not.toHaveBeenCalled();
    expect(NOTIF_SYNC_EVENT).toBe("notif-sync");
  });

  it("unsubscribing stops future announcements", () => {
    const win = new WindowShim();
    const handler = vi.fn();
    const unsubscribe = subscribeNotifSync(win, handler);

    unsubscribe();
    dispatchNotifSync(win);

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("bell dismiss → panel refetch → badge clears", () => {
  it("refetches the panel and clears the badge when the bell dismisses a request", async () => {
    const rig = createRig();
    await rig.init(); // mirror the panel's mount-time load
    expect(rig.panelBadge()).toBe(3);

    // One bell dismiss for REQ_A (SLA/review keys for a single request).
    await rig.bellDismiss([REVIEW_KEY_A]);

    // The panel refetched on the announcement...
    expect(rig.panelRefetches()).toBe(2);
    expect(rig.fetchMock).toHaveBeenCalledWith("/api/notifications/in-app");
    // ...and the server-side read route cleared REQ_A's in-app alerts, so the
    // badge now shows only the untouched REQ_B alert.
    expect(rig.panelBadge()).toBe(1);
    expect(rig.panelAlerts().map((a) => a.costingRequestId)).toEqual([REQ_B]);

    // The bell's own tray also converged already — the refetched feed filtered
    // the dismissed key server-side, with no local hide state and no 60s poll.
    expect(rig.bellKeys()).toEqual([OVERDUE_KEY_B]);

    // Dismissing REQ_B empties the tray entirely — it renders nothing.
    await rig.bellDismiss([OVERDUE_KEY_B]);
    expect(rig.panelBadge()).toBe(0);
    expect(rig.panelAlerts()).toEqual([]);
    expect(rig.bellKeys()).toEqual([]);
  });

  it("clears only the dismissed request's alerts, never another request's", async () => {
    const rig = createRig();
    await rig.init();
    expect(rig.panelBadge()).toBe(3);

    await rig.bellDismiss([REVIEW_KEY_A]);

    // REQ_A's two alerts are gone; REQ_B's untouched alert survives.
    expect(rig.panelAlerts().map((a) => a.costingRequestId)).toEqual([REQ_B]);
    expect(rig.panelBadge()).toBe(1);
  });

  it("leaves the panel stale after unsubscribe — only the bell refetches", async () => {
    const rig = createRig();
    await rig.init();
    rig.unsubscribePanel();

    await rig.bellDismiss([REVIEW_KEY_A]);

    // The panel no longer listens, so no in-app refetch; the bell itself still
    // reloads its own feed on the channel (init load + this dismissal).
    expect(rig.panelRefetches()).toBe(1);
    expect(rig.panelBadge()).toBe(3);
    expect(rig.bellRefetches()).toBe(2);
    expect(rig.bellKeys()).toEqual([OVERDUE_KEY_B]);
  });

  it("keeps the item visible and skips the announce when the read write fails, then converges on retry", async () => {
    const rig = createRig();
    await rig.init();
    expect(rig.panelRefetches()).toBe(1);
    expect(rig.bellKeys()).toEqual([REVIEW_KEY_A, OVERDUE_KEY_B]);

    // The dismissal write fails: no notif-sync announce, so neither surface
    // refetches, no server state changed, and the item stays in the feed — the
    // bell surfaces its retry affordance here instead of silently losing the
    // user's action.
    rig.failNextRead();
    await rig.bellDismiss([REVIEW_KEY_A]);
    expect(rig.panelRefetches()).toBe(1);
    expect(rig.bellRefetches()).toBe(1);
    expect(rig.bellKeys()).toEqual([REVIEW_KEY_A, OVERDUE_KEY_B]);

    // Retry: the write succeeds and both surfaces converge immediately.
    await rig.bellDismiss([REVIEW_KEY_A]);
    expect(rig.panelRefetches()).toBe(2);
    expect(rig.bellKeys()).toEqual([OVERDUE_KEY_B]);
  });
});

describe("cross-window convergence (read receipts propagate without the poll)", () => {
  it("a dismissal in one window converges another window on its next load", async () => {
    const server = createFakeServer();
    const windowA = createRig(server);
    const windowB = createRig(server);

    await windowA.init();
    await windowB.init();

    // Both windows see the same two items.
    expect(windowA.bellKeys()).toEqual([REVIEW_KEY_A, OVERDUE_KEY_B]);
    expect(windowB.bellKeys()).toEqual([REVIEW_KEY_A, OVERDUE_KEY_B]);

    // Window A dismisses REQ_A. The receipt lands in the durable server store
    // and only A's own channel announces (each rig has its own EventTarget, so
    // no event crosses windows) — A converges immediately.
    await windowA.bellDismiss([REVIEW_KEY_A]);
    expect(windowA.bellKeys()).toEqual([OVERDUE_KEY_B]);
    expect(server.readReceipts().has(REVIEW_KEY_A)).toBe(true);

    // B never heard the event and its 60s poll has not fired — it still shows
    // the stale two items from its last fetch.
    expect(windowB.bellKeys()).toEqual([REVIEW_KEY_A, OVERDUE_KEY_B]);

    // B's very next load — any reload, or eventually its poll — fetches the
    // server-filtered feed. The receipt propagated via durable server state,
    // not via A's event and not on a poll deadline.
    await windowB.bellRefresh();
    expect(windowB.bellKeys()).toEqual([OVERDUE_KEY_B]);

    // A brand-new tab opening after the dismissal converges on first load.
    const windowC = createRig(server);
    await windowC.init();
    expect(windowC.bellKeys()).toEqual([OVERDUE_KEY_B]);
  });
});

describe("reverse direction: panel mark-all-read reloads the bell", () => {
  it("empties the bell feed immediately instead of waiting for the 60s poll", async () => {
    const rig = createRig();
    await rig.init(); // mirror both components' mount-time loads
    expect(rig.bellRefetches()).toBe(1);

    await rig.panelMarkAllRead();

    // The bell reloaded its feed on the announce (init load + this one) and the
    // mark-all-read route dismissed every receipt server-side, so the tray is
    // already empty — again, no poll and no local hide state.
    expect(rig.bellRefetches()).toBe(2);
    expect(rig.bellKeys()).toEqual([]);
  });
});