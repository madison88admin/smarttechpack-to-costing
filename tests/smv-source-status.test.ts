import { describe, expect, it } from "vitest";
import { smvSourceStatus } from "../src/lib/costing/history";

// SMV source status: tells Costing where a style's knitting time comes from —
// or flags styles that still lack it entirely.

describe("smvSourceStatus", () => {
  it("flags missing knitting time regardless of source", () => {
    expect(smvSourceStatus({ knitting_time: null, source: "import" })).toEqual({
      key: "missing",
      label: "Missing",
      hasValue: false
    });
    expect(smvSourceStatus({ knitting_time: null, source: "nextgen" })).toEqual({
      key: "missing",
      label: "Missing",
      hasValue: false
    });
    expect(smvSourceStatus({ knitting_time: undefined, source: undefined })).toEqual({
      key: "missing",
      label: "Missing",
      hasValue: false
    });
  });

  it("labels NextGen-synced rows as NextGen SMV", () => {
    expect(smvSourceStatus({ knitting_time: 0.42, source: "nextgen" })).toEqual({
      key: "nextgen",
      label: "NextGen SMV",
      hasValue: true
    });
  });

  it("labels approved costings as Factory CBD by default", () => {
    expect(smvSourceStatus({ knitting_time: 12.5, source: "import" })).toEqual({
      key: "cbd",
      label: "Factory CBD",
      hasValue: true
    });
    // Legacy rows without a source column value default to import.
    expect(smvSourceStatus({ knitting_time: 12.5, source: null })).toEqual({
      key: "cbd",
      label: "Factory CBD",
      hasValue: true
    });
    expect(smvSourceStatus({ knitting_time: 12.5, source: undefined })).toEqual({
      key: "cbd",
      label: "Factory CBD",
      hasValue: true
    });
  });

  it("treats zero as a real value, not missing", () => {
    expect(smvSourceStatus({ knitting_time: 0, source: "nextgen" }).key).toBe("nextgen");
    expect(smvSourceStatus({ knitting_time: 0, source: "import" }).key).toBe("cbd");
  });
});
