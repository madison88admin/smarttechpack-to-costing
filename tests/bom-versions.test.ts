import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bomFingerprint,
  checkBomVersions,
  previewBomVersionCheck
} from "../src/lib/nextgen/bom-versions";
import { createMockSupabase, updates, type Responder } from "./helpers/supabase-mock";

// checkBomVersions: baseline recording, NextGen BOM version change detection,
// per-request costing alerts, and snapshot refresh — against mocked Supabase
// + mocked NextGen BOM fetch.

const { mocks } = vi.hoisted(() => ({
  mocks: {
    client: null as unknown,
    fetchBom: null as unknown,
    enqueue: null as unknown,
    recordEvent: null as unknown
  }
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

vi.mock("@/lib/nextgen/bom", () => ({
  fetchBom: (...args: unknown[]) => (mocks.fetchBom as (...a: unknown[]) => Promise<unknown>)(...args)
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
  { id: "req-1", request_number: "CR-100001", factory_name: "Hangzhou U-Jump", product_id: "prod-1" },
  { id: "req-2", request_number: "CR-100002", factory_name: "Hangzhou U-Jump", product_id: "prod-1" }
];

function responder(overrides: Partial<Responder> = {}): Responder {
  return {
    costing_requests: {
      select: () => ({ data: activeRequests, error: null })
    },
    nextgen_products: {
      select: () => ({
        data: [
          {
            id: "prod-1",
            nextgen_entity_id: "14451",
            style_number: "M88100481 - 3",
            bom_version: "1",
            bom_version_comment: "Default"
          }
        ],
        error: null
      }),
      update: () => ({ data: [], error: null })
    },
    ...overrides
  };
}

function bomResult(lines: Array<{ headerVersion?: string; bomVersionComment?: string }>) {
  return {
    ok: true,
    status: 200,
    upstreamContentType: "application/json",
    data: lines.map((line, i) => ({
      id: String(i + 1),
      category: "Yarn",
      materialName: `Material ${i + 1}`,
      headerVersion: line.headerVersion,
      bomVersionComment: line.bomVersionComment
    })),
    total: lines.length,
    rawBody: {}
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetchBom = vi.fn();
  mocks.enqueue = vi.fn().mockResolvedValue(0);
  mocks.recordEvent = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bomFingerprint", () => {
  it("combines version and comment", () => {
    expect(bomFingerprint("1", "Default")).toBe("1|Default");
    expect(bomFingerprint("2", null)).toBe("2|");
    expect(bomFingerprint(null, null)).toBe("|");
    expect(bomFingerprint()).toBe("|");
  });
});

describe("checkBomVersions", () => {
  it("records a baseline on first check without alerting", async () => {
    (mocks.fetchBom as ReturnType<typeof vi.fn>).mockResolvedValue(
      bomResult([{ headerVersion: "3", bomVersionComment: "New" }])
    );
    const { client, calls } = createMockSupabase(
      responder({
        nextgen_products: {
          select: () => ({
            data: [
              {
                id: "prod-1",
                nextgen_entity_id: "14451",
                style_number: "M88100481 - 3",
                bom_version: null,
                bom_version_comment: null
              }
            ],
            error: null
          }),
          update: () => ({ data: [], error: null })
        }
      })
    );
    mocks.client = client;

    const result = await checkBomVersions();

    expect(result.checked).toBe(1);
    expect(result.baselined).toBe(1);
    expect(result.changed).toBe(0);
    expect(result.alertedRequests).toBe(0);
    expect(mocks.enqueue).not.toHaveBeenCalled();

    const snapshots = updates(calls, "nextgen_products");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ bom_version: "3", bom_version_comment: "New" });
  });

  it("alerts every active request when the NextGen BOM version changed", async () => {
    (mocks.fetchBom as ReturnType<typeof vi.fn>).mockResolvedValue(
      bomResult([{ headerVersion: "2", bomVersionComment: "Updated after PBD review" }])
    );
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    const result = await checkBomVersions();

    expect(result.changed).toBe(1);
    expect(result.alertedRequests).toBe(2);
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(mocks.recordEvent).toHaveBeenCalledTimes(2);

    const firstAlert = (mocks.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstAlert.requestId).toBe("req-1");
    expect(firstAlert.kind).toBe("bom_changed");
    expect(firstAlert.subject).toContain("CR-100001");
    expect(firstAlert.subject).toContain("v1 → v2");
    expect(firstAlert.body).toContain("Updated after PBD review");
    expect(firstAlert.body).toContain("M88100481 - 3");

    const secondAlert = (mocks.enqueue as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(secondAlert.requestId).toBe("req-2");
    expect(secondAlert.subject).toContain("CR-100002");

    // Snapshot refreshed to the new version once per product.
    const snapshots = updates(calls, "nextgen_products");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ bom_version: "2", bom_version_comment: "Updated after PBD review" });
  });

  it("alerts when a previously versionless BOM gains a version", async () => {
    (mocks.fetchBom as ReturnType<typeof vi.fn>).mockResolvedValue(
      bomResult([{ headerVersion: "1", bomVersionComment: "New BOM" }])
    );
    const { client } = createMockSupabase(
      responder({
        nextgen_products: {
          select: () => ({
            data: [
              {
                id: "prod-1",
                nextgen_entity_id: "14451",
                style_number: "M88100481 - 3",
                bom_version: null,
                bom_version_comment: null,
                bom_checked_at: "2026-08-01T00:00:00Z"
              }
            ],
            error: null
          }),
          update: () => ({ data: [], error: null })
        }
      })
    );
    mocks.client = client;

    const result = await checkBomVersions();

    expect(result.changed).toBe(1);
    expect(result.alertedRequests).toBe(2);
    expect(result.baselined).toBe(0);
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
  });

  it("does not re-baseline or alert a checked versionless style", async () => {
    (mocks.fetchBom as ReturnType<typeof vi.fn>).mockResolvedValue(bomResult([]));
    const { client } = createMockSupabase(
      responder({
        nextgen_products: {
          select: () => ({
            data: [
              {
                id: "prod-1",
                nextgen_entity_id: "14451",
                style_number: "M88100481 - 3",
                bom_version: null,
                bom_version_comment: null,
                bom_checked_at: "2026-08-01T00:00:00Z"
              }
            ],
            error: null
          }),
          update: () => ({ data: [], error: null })
        }
      })
    );
    mocks.client = client;

    const result = await checkBomVersions();

    expect(result.changed).toBe(0);
    expect(result.baselined).toBe(0);
    expect(result.alertedRequests).toBe(0);
  });

  it("detects a comment-only change on the same version number", async () => {
    (mocks.fetchBom as ReturnType<typeof vi.fn>).mockResolvedValue(
      bomResult([{ headerVersion: "1", bomVersionComment: "Renamed" }])
    );
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const result = await checkBomVersions();

    expect(result.changed).toBe(1);
    expect(result.alertedRequests).toBe(2);
  });

  it("stays quiet when the BOM version is unchanged", async () => {
    (mocks.fetchBom as ReturnType<typeof vi.fn>).mockResolvedValue(
      bomResult([{ headerVersion: "1", bomVersionComment: "Default" }])
    );
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const result = await checkBomVersions();

    expect(result.changed).toBe(0);
    expect(result.alertedRequests).toBe(0);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("records an error when the NextGen BOM fetch fails and does not crash", async () => {
    (mocks.fetchBom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      upstreamContentType: "text/html",
      data: [],
      total: 0,
      rawBody: {}
    });
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const result = await checkBomVersions();

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

    const result = await checkBomVersions();

    expect(result.checked).toBe(0);
    expect(result.errors).toEqual([]);
  });
});

describe("previewBomVersionCheck", () => {
  it("counts active requests and styles with a stored version", async () => {
    const { client } = createMockSupabase({
      costing_requests: {
        select: () => ({
          data: [{ product_id: "p1" }, { product_id: "p1" }, { product_id: "p2" }, { product_id: null }],
          error: null
        })
      },
      nextgen_products: { select: () => ({ data: [{ id: "p1" }], error: null }) }
    });
    mocks.client = client;

    const preview = await previewBomVersionCheck();

    expect(preview.activeRequests).toBe(4);
    expect(preview.uniqueStyles).toBe(2);
    expect(preview.baselined).toBe(1);
  });
});
