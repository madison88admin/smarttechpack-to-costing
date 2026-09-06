// Shared wiring for the cross-surface "notifications changed" channel.
//
// The bell and the change-alerts panel both dispatch and subscribe to this one
// event: dismissing bell receipts (or marking everything read on the panel)
// announces the change so the other surface refetches immediately instead of
// waiting up to 60s for its poll. Keeping the contract here means the two
// components can never drift apart, and the client-side test rig drives exactly
// this code against a minimal DOM shim instead of re-implementing the flow.

export const NOTIF_SYNC_EVENT = "notif-sync";

export type SyncTarget = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  dispatchEvent(event: Event): boolean;
};

/**
 * Announces that notification read state changed. Subscribers refetch their
 * feeds. Works against the real `window` and the test rig's minimal DOM shim.
 */
export function dispatchNotifSync(target: SyncTarget): void {
  target.dispatchEvent(new Event(NOTIF_SYNC_EVENT));
}

/**
 * Subscribes a handler to the sync channel and returns the unsubscribe
 * function, so effect cleanups never leak listeners across polls or unmounts.
 */
export function subscribeNotifSync(target: SyncTarget, handler: () => void): () => void {
  target.addEventListener(NOTIF_SYNC_EVENT, handler);
  return () => target.removeEventListener(NOTIF_SYNC_EVENT, handler);
}