import { describe, expect, it, vi } from "vitest";
import { offers, survey } from "./helpers/element-survey";
import { createMockSupabase } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";
import type { UserRole } from "../src/lib/auth/roles";
import { RequestCommentsPanel } from "../src/components/request-comments-panel";

// Pins the RENDER-SITE wiring of the role boundary. `tests/panel-role-gating.test.tsx`
// covers what each panel does with the flags it is handed, but it cannot catch the
// page handing a panel — or an inline control — the wrong rule: flip a predicate in
// page.tsx and every panel test still passes. These tests call the real page
// components with a real signed session and inspect the element tree the page
// returns, so a wrong predicate, a hardcoded role prop, or a control added without
// its route's gate fails here instead of needing a live run to notice.
//
// They stop at the element tree on purpose: no renderer is involved, so there is no
// app-router context to fake and the assertion is about the page's own decision.

const mocks = vi.hoisted(() => ({ token: null as string | null, client: null as unknown }));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (mocks.token ? { value: mocks.token } : undefined) })
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
  usePathname: () => "/",
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} })
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => mocks.client }));

// The queue read and the two ERP/pricing readers are mocked so the pages can be
// driven as pure wiring: everything asserted below is page-owned JSX and props.
vi.mock("@/lib/costing/request-listing", () => ({
  listScopedRequestPage: async () => ({ rows: [], total: 0, error: null }),
  REQUEST_PAGE_SIZE: 25
}));

vi.mock("@/lib/costing/nextgen-pricing", () => ({
  getNextGenPricingForRequest: async () => ({
    sellingPrice: null,
    landedCost: null,
    purchasePrice: null,
    margin: null,
    currency: null
  })
}));

vi.mock("@/lib/costing/master-benchmark", () => ({
  flagCbdAgainstMasterBenchmark: async () => ({ flags: [], benchmark: [], error: null })
}));

import RequestsPage from "../src/app/requests/page";
import RequestDetailPage from "../src/app/requests/[id]/page";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const REQUEST = {
  id: REQUEST_ID,
  request_number: "CR-WIRE-1",
  status: "for_pbd_review",
  factory_name: "Wiring Test Factory",
  assigned_factory_user_id: null,
  customer_status: "not_submitted",
  pbd_pricing: {},
  validation_results: [],
  approval_actions: [],
  nextgen_products: null,
  baseline_ref: null,
  created_at: "2026-01-02T03:04:05.000Z",
  updated_at: "2026-01-02T03:04:05.000Z",
  // One CBD on purpose: it is what makes the CBD-detail export link render at all,
  // so its absence for Viewer is a real assertion.
  factory_cbds: [{ id: "cbd-1", raw_payload: {}, cbd_material_lines: [], submitted_at: "2026-01-01T00:00:00.000Z" }]
};

async function renderAs<T>(role: UserRole, render: () => Promise<T>) {
  mocks.token = await issueSessionToken(role);
  mocks.client = createMockSupabase({
    costing_requests: {
      single: () => ({ data: REQUEST, error: null }),
      maybeSingle: () => ({ data: REQUEST, error: null }),
      select: () => ({ data: [], error: null })
    }
  }).client;
  return survey(await render());
}

// The CSV href carries the current filters, so match on the endpoint path.
const QUEUE_EXPORTS = ["/api/export/requests.csv", "/api/export/cbd-detail.csv"];

/** Renders the queue page for one role with a real signed session. */
async function renderQueueAs(role: UserRole) {
  mocks.token = await issueSessionToken(role);
  mocks.client = createMockSupabase({}).client;
  return survey(await RequestsPage({ searchParams: {} }));
}

describe("queue page — download links follow their endpoints", () => {
  it("offers both downloads to the working internal roles", async () => {
    for (const role of ["pbd", "costing", "md", "admin"] as UserRole[]) {
      const { hrefs } = await renderQueueAs(role);
      for (const href of QUEUE_EXPORTS) {
        expect(offers(hrefs, href), `${role} should see ${href} — got ${JSON.stringify(hrefs)}`).toBe(true);
      }
    }
  });

  // Regression: the links were gated on `role !== "factory"` while both endpoints
  // answer 401 to Viewer, so Viewer was offered two downloads that could only fail.
  it("withholds both downloads from the read-only Viewer", async () => {
    const { hrefs, text } = await renderQueueAs("viewer");
    for (const href of QUEUE_EXPORTS) {
      expect(offers(hrefs, href), `viewer must not be offered ${href}`).toBe(false);
    }
    expect(text).not.toContain("Export CSV");
  });

  it("keeps the queue panel link-free for Factory, whose downloads live on the Factory view", async () => {
    const { hrefs } = await renderQueueAs("factory");
    for (const href of QUEUE_EXPORTS) {
      expect(offers(hrefs, href), `factory must not be offered ${href}`).toBe(false);
    }
  });
});

describe("request detail page — panel wiring carries the session role", () => {
  const renderDetail = (role: UserRole) =>
    renderAs(role, () => RequestDetailPage({ params: { id: REQUEST_ID } }));

  it.each(["pbd", "viewer"] as UserRole[])("hands the comments panel the signed-in role (%s)", async (role) => {
    const { find } = await renderDetail(role);
    const [panel] = find(RequestCommentsPanel);
    expect(panel, "comments panel should be rendered").toBeDefined();
    // The panel withholds the write box from Viewer; what this pins is that the
    // page passes the real role through instead of a hardcoded one.
    expect((panel.props as { role?: string }).role).toBe(role);
  });

  it("offers the CBD-detail export to PBD and withholds it from Viewer", async () => {
    const exportHref = `/api/export/cbd-detail.csv?requestId=${REQUEST_ID}`;
    const pbd = await renderDetail("pbd");
    expect(pbd.hrefs, `detail hrefs: ${JSON.stringify(pbd.hrefs.slice(0, 8))}`).toContain(exportHref);
    const viewer = await renderDetail("viewer");
    expect(viewer.hrefs, "the endpoint answers 401 for Viewer").not.toContain(exportHref);
    // The link only exists because the request has a CBD, so the assertion above
    // is about the role gate and not an absent control.
  });
});
