import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ValidationChecklist } from "../src/components/validation-checklist";
import { RequestCommentsPanel } from "../src/components/request-comments-panel";
import { SampleTrackingPanel } from "../src/components/sample-tracking-panel";
import { PbdPricingPanel } from "../src/components/pbd-pricing-panel";

// The detail page passes each lane's own rule into these panels
// (canRunCostingAction / canRunPbdAction). These tests pin the panels' side of
// that contract, because the panels with a write action live in non-default
// tabs and are therefore NOT in the server-rendered HTML of a page fetch — the
// role matrix can only see the Overview tab. Two regressions are covered here:
// the checklist offered its Save button to every non-factory role, and the
// samples form was wired to the Costing rule while the route reserves samples
// for PBD.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} })
}));

const CHECKLIST = [
  { code: "moq_checked", label: "MOQ checked", is_checked: true, comment: "", is_required: true },
  { code: "notes_reviewed", label: "Notes reviewed", is_checked: false, comment: "", is_required: false }
];

describe("ValidationChecklist — Costing-owned", () => {
  it("offers the save action to the owning lane", () => {
    const html = renderToStaticMarkup(<ValidationChecklist requestId="r1" items={CHECKLIST} canEdit />);
    expect(html).toContain("Save Checklist");
    expect(html).not.toContain("Read-only");
    expect(html).not.toContain("disabled");
  });

  it("renders read-only with disabled boxes for every other internal role", () => {
    const html = renderToStaticMarkup(<ValidationChecklist requestId="r1" items={CHECKLIST} canEdit={false} />);
    expect(html).not.toContain("Save Checklist");
    expect(html).toContain("Read-only — the Costing Team saves this checklist.");
    expect(html.match(/disabled/g)?.length).toBe(CHECKLIST.length);
  });
});

describe("SampleTrackingPanel — PBD-owned", () => {
  it("offers the add form to PBD", () => {
    const html = renderToStaticMarkup(<SampleTrackingPanel requestId="r1" canEdit />);
    expect(html).toContain("Add Sample");
  });

  it("stays visible but read-only for Costing, who may not add samples", () => {
    const html = renderToStaticMarkup(<SampleTrackingPanel requestId="r1" canEdit={false} />);
    expect(html).toContain("Sample Tracking");
    expect(html).not.toContain("Add Sample");
  });
});

describe("RequestCommentsPanel — readable thread, writes follow the route", () => {
  it("offers the box to a role the route accepts", () => {
    const html = renderToStaticMarkup(<RequestCommentsPanel requestId="r1" initialComments={[]} role="pbd" />);
    expect(html).toContain("Save Buyer Comments");
    expect(html).not.toContain("Read-only");
  });

  // Regression: /api/costing/requests/[id]/comments refuses Viewer with a 403,
  // so the page offered a box whose only possible outcome was an error.
  it("gives the read-only Viewer no box, while keeping the thread visible", () => {
    const html = renderToStaticMarkup(<RequestCommentsPanel requestId="r1" initialComments={[]} role="viewer" />);
    expect(html).not.toContain("Save Comments");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("Read-only");
  });
});

const PRICING_PROPS = {
  requestId: "r1",
  pricing: null,
  pricingStatus: null,
  nextgenSellingPrice: 3.75,
  nextgenLandedCost: 2.98,
  nextgenMargin: 0.77,
  nextgenCurrency: "USD"
};

describe("PbdPricingPanel — PBD-owned and stage-gated", () => {
  it("offers the save action to PBD inside the review stage", () => {
    const html = renderToStaticMarkup(<PbdPricingPanel {...PRICING_PROPS} status="for_pbd_review" canEdit />);
    expect(html).toContain("Save PBD Pricing");
  });

  it("withholds it from Costing", () => {
    const html = renderToStaticMarkup(<PbdPricingPanel {...PRICING_PROPS} status="for_pbd_review" canEdit={false} />);
    expect(html).not.toContain("Save PBD Pricing");
    expect(html).toContain("Pricing is read-only outside the internal review stage.");
  });

  it("withholds it from PBD outside the review stage", () => {
    const html = renderToStaticMarkup(<PbdPricingPanel {...PRICING_PROPS} status="approved" canEdit />);
    expect(html).not.toContain("Save PBD Pricing");
  });
});
