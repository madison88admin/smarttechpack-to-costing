import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  metadataFingerprint,
  refreshActiveProductMetadata
} from "../src/lib/nextgen/metadata-refresh";
import { nextGenMetaFromRaw } from "../src/lib/nextgen/product-meta";
import { createMockSupabase, updates, type Responder } from "./helpers/supabase-mock";

// refreshActiveProductMetadata: NextGen product-row re-fetch, metadata diff,
// costing alerts on change, and the checked-at stamp (graceful when migration
// 009 is pending) — against mocked Supabase + mocked NextGen search.

const { mocks } = vi.hoisted(() => ({
  mocks: {
    client: null as unknown,
    search: null as unknown,
    enqueue: null as unknown,
    recordEvent: null as unknown
  }
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

vi.mock("@/lib/nextgen/client", () => ({
  legacyKendoSearchPayload: (query: string) => ({ take: 20, skip: 0, filter: `Name~contains~'${query}'` }),
  nextGenPost: (...args: unknown[]) => (mocks.search as (...a: unknown[]) => Promise<unknown>)(...args)
}));

vi.mock("@/lib/notifications/workflow-alerts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/notifications/workflow-alerts")>();
  return {
    ...original,
    enqueueChangeAlert: (...args: unknown[]) =>
      (mocks.enqueue as (...a: unknown[]) => Promise<unknown>)(...args)
  };
});

vi.mock("@/lib/workflow/events", () => ({
  recordWorkflowEvent: (...args: unknown[]) =>
    (mocks.recordEvent as (...a: unknown[]) => Promise<unknown>)(...args)
}));

const activeRequests = [
  { id: "req-1", request_number: "CR-100001", factory_name: "Hangzhou U-Jump", product_id: "prod-1" }
];

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    nextgen_entity_id: "14451",
    style_number: "M88100481 - 3",
    raw_payload: {
      Name: "M88100481 - 3",
      StatusName: "Active",
      CompositionConcatenated: "100% Acrylic",
      SMV: "0.45",
      GsdSMV: "0.42",
      AllowedTime: "0.48",
      FactoryTime: "0.51"
    },
    ...overrides
  };
}

function responder(overrides: Partial<Responder> = {}): Responder {
  return {
    costing_requests: {
      select: () => ({ data: activeRequests, error: null })
    },
    nextgen_products: {
      select: () => ({ data: [productRow()], error: null }),
      update: () => ({ data: [], error: null })
    },
    ...overrides
  };
}

function searchResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    upstreamContentType: "application/json",
    body: {
      Data: [
        {
          Id: "14451",
          Name: "M88100481 - 3",
          StatusName: "Active",
          CompositionConcatenated: "100% Acrylic",
          SMV: "0.45",
          GsdSMV: "0.42",
          AllowedTime: "0.48",
          FactoryTime: "0.51",
          ...overrides
        }
      ],
      Total: 1
    }
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.search = vi.fn();
  mocks.enqueue = vi.fn().mockResolvedValue(0);
  mocks.recordEvent = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("metadataFingerprint", () => {
  it("is stable for equal metadata and changes when a field differs", () => {
    const raw = {
      StatusName: "Active",
      CompositionConcatenated: "100% Acrylic",
      SMV: "0.45",
      GsdSMV: "0.42",
      AllowedTime: "0.48",
      FactoryTime: "0.51"
    };
    const meta = nextGenMetaFromRaw(raw);
    expect(metadataFingerprint(meta)).toBe(metadataFingerprint(nextGenMetaFromRaw({ ...raw })));
    expect(metadataFingerprint(meta)).not.toBe(metadataFingerprint(nextGenMetaFromRaw({ ...raw, SMV: "0.5" })));
    expect(metadataFingerprint(meta)).not.toBe(metadataFingerprint(nextGenMetaFromRaw({ ...raw, StatusName: "Dropped" })));
  });
});

describe("refreshActiveProductMetadata", () => {
  it("keeps quiet when metadata is unchanged and stamps the checked-at time", async () => {
    (mocks.search as ReturnType<typeof vi.fn>).mockResolvedValue(searchResult());
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    const result = await refreshActiveProductMetadata();

    expect(result.checked).toBe(1);
    expect(result.changed).toBe(0);
    expect(result.alertedRequests).toBe(0);
    expect(result.updatedAt).not.toBeNull();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.recordEvent).not.toHaveBeenCalled();

    const snapshots = updates(calls, "nextgen_products");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ metadata_checked_at: expect.any(String) });
    expect((snapshots[0] as { raw_payload: Record<string, unknown> }).raw_payload.Id).toBe("14451");
  });

  it("alerts costing when the live metadata differs from the stored snapshot", async () => {
    (mocks.search as ReturnType<typeof vi.fn>).mockResolvedValue(
      searchResult({ StatusName: "Dropped", CompositionConcatenated: "60% Cotton 40% Poly" })
    );
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const result = await refreshActiveProductMetadata();

    expect(result.changed).toBe(1);
    expect(result.alertedRequests).toBe(1);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.recordEvent).toHaveBeenCalledTimes(1);

    const alert = (mocks.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(alert.requestId).toBe("req-1");
    expect(alert.kind).toBe("bom_changed");
    expect(alert.subject).toContain("CR-100001");
    expect(alert.body).toContain("Status: Active → Dropped");
    expect(alert.body).toContain("Composition: 100% Acrylic → 60% Cotton 40% Poly");

    const event = (mocks.recordEvent as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(event.eventType).toBe("nextgen_metadata_changed");
    expect(event.actorRole).toBe("system");
  });

  it("updates the snapshot even when nothing changed (fresh payload replaces stored raw)", async () => {
    (mocks.search as ReturnType<typeof vi.fn>).mockResolvedValue(searchResult());
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    await refreshActiveProductMetadata();

    const snapshots = updates(calls, "nextgen_products");
    expect(snapshots).toHaveLength(1);
  });

  it("degrades gracefully when migration 009 (metadata_checked_at) is pending", async () => {
    (mocks.search as ReturnType<typeof vi.fn>).mockResolvedValue(searchResult());
    let first = true;
    // The mock routes .update() through the "select" terminal with a payload;
    // key off chain.payload to distinguish the product fetch from the update.
    const { client } = createMockSupabase(
      responder({
        nextgen_products: {
          select: (chain) => {
            if (chain.payload) {
              if (first) {
                first = false;
                return { data: [], error: { message: "column costing_requests.metadata_checked_at does not exist" } };
              }
              return { data: [], error: null };
            }
            return { data: [productRow()], error: null };
          }
        }
      })
    );
    mocks.client = client;

    const result = await refreshActiveProductMetadata();

    expect(result.updatedAt).toBeNull();
    expect(result.errors).toEqual([]); // fallback succeeded — no error recorded
  });

  it("records an error when the NextGen search fails and does not crash", async () => {
    (mocks.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      upstreamContentType: "text/html",
      body: "boom"
    });
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const result = await refreshActiveProductMetadata();

    expect(result.checked).toBe(1);
    expect(result.changed).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("M88100481 - 3");
  });

  it("returns early when there are no active requests", async () => {
    const { client } = createMockSupabase({
      costing_requests: { select: () => ({ data: [], error: null }) }
    });
    mocks.client = client;

    const result = await refreshActiveProductMetadata();

    expect(result.checked).toBe(0);
    expect(result.errors).toEqual([]);
    expect(mocks.search).not.toHaveBeenCalled();
  });
});

