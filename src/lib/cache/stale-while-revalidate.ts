/**
 * The app's two cache primitives, in one place.
 *
 * Three surfaces previously hand-rolled this: NextGen filter options (up to 20
 * ERP pages behind a 15s deadline), the historical distinct-value index (a
 * full-pool scan), and the NextGen response/image maps. Each blocked the first
 * caller after a TTL expiry, which is what made list screens stall on a
 * five-minute schedule.
 *
 *   - createTtlMap       memoizes an upstream response by key (sync, cheap).
 *   - createStaleWhileRevalidateCache
 *                        owns one expensive derived value: serve the stale
 *                        value while a background refresh runs, coalesce
 *                        concurrent refreshes into one build, and only make a
 *                        caller wait when nothing has ever been built.
 *
 * A caller that needs the value to survive a process restart passes a
 * `snapshot` (load/save); persistence stays out of the module that builds the
 * value, and the cache stays ignorant of where snapshots live.
 */

export type TtlMap<V> = {
  get: (key: string) => V | null;
  set: (key: string, value: V) => void;
};

/** Memoize values by key for a fixed time. Expired entries are dropped on read. */
export function createTtlMap<V>(ttlMs: number): TtlMap<V> {
  const entries = new Map<string, { value: V; expiresAt: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key, value) {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    }
  };
}

export type StaleWhileRevalidateCache<T> = {
  /** Fresh value, or the stale one with a refresh kicked off, or a fresh build. */
  get: () => Promise<T>;
};

/** Durable layer: the last built value, and when it was built. */
export type CacheSnapshot<T> = {
  load: () => Promise<{ data: T; savedAt: number } | null>;
  save: (data: T) => Promise<void>;
};

export function createStaleWhileRevalidateCache<T>(input: {
  ttlMs: number;
  build: () => Promise<T>;
  snapshot?: CacheSnapshot<T>;
}): StaleWhileRevalidateCache<T> {
  const { ttlMs, build, snapshot } = input;
  let cached: { data: T; expiresAt: number } | null = null;
  let inFlight: Promise<T> | null = null;
  let seeded = false;

  /**
   * Starts from the durable value, once per process. A snapshot older than the
   * TTL seeds an already-stale entry, so the next get() serves it immediately
   * and refreshes behind the caller instead of making the first request after a
   * deploy pay for the whole build.
   */
  const seed = async () => {
    if (seeded) return;
    try {
      const stored = snapshot ? await snapshot.load() : null;
      if (stored) cached = { data: stored.data, expiresAt: stored.savedAt + ttlMs };
    } catch {
      // No durable layer (not migrated, database unreachable): build instead.
    } finally {
      seeded = true;
    }
  };

  const refresh = () => {
    if (inFlight) return inFlight;
    inFlight = build()
      .then((data) => {
        cached = { data, expiresAt: Date.now() + ttlMs };
        if (snapshot) void snapshot.save(data).catch(() => {});
        return data;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    async get() {
      await seed();
      const entry = cached;
      if (entry && Date.now() < entry.expiresAt) return entry.data;
      if (entry) {
        // Stale-while-revalidate: a stale value still renders, so never make a
        // caller wait for the rebuild. A failed refresh leaves the stale value
        // in place — the next get() tries again.
        void refresh().catch(() => {});
        return entry.data;
      }
      return refresh();
    }
  };
}
