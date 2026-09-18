import { describe, expect, it } from "vitest";
import { isFactoryAllowedPath } from "../src/lib/auth/factory-paths";

// The middleware confines factory sessions to their own workspace. Every entry
// here exists because a factory screen calls it, and a missing entry is a 403
// on a control the user can see — the photo panel in the CBD wizard was exactly
// that, and its 403 was observed live in the browser console.

const REQUEST = "11111111-1111-4111-8111-111111111111";

describe("factory path allowlist — allowed", () => {
  it.each([
    ["the workspace root", "/"],
    ["their scoped request list", "/requests"],
    ["their list item", `/requests/${REQUEST}`],
    ["the CBD wizard", `/factory/${REQUEST}`],
    ["the revision comparison the wizard links to", `/requests/${REQUEST}/cbd-diff`],
    ["saving/submitting a CBD", `/api/costing/requests/${REQUEST}/cbd`],
    ["structured change requests", `/api/costing/requests/${REQUEST}/change-requests`],
    ["the photo panel's read, called on mount", `/api/costing/requests/${REQUEST}/photos`],
    ["the notification bell", "/api/notifications/pending"],
    ["marking notifications read", "/api/notifications/read"],
    ["logout", "/api/auth/logout"],
    ["the BOM import the wizard uses", "/api/costing/import"],
    ["product images", "/api/product/M8836207/image"]
  ])("allows %s", (_label, path) => {
    expect(isFactoryAllowedPath(path)).toBe(true);
  });
});

describe("factory path allowlist — refused", () => {
  it.each([
    ["reports", "/reports"],
    ["the internal history register", "/history"],
    ["the admin surface", "/api/admin/recipients"],
    ["the request pricing route", `/api/costing/requests/${REQUEST}/pricing`],
    ["another request's detail page", `/requests/${REQUEST}/edit`],
    ["an export", "/api/export/register.csv"],
    ["a non-uuid request id", "/api/costing/requests/not-a-uuid/photos"]
  ])("refuses %s", (_label, path) => {
    expect(isFactoryAllowedPath(path)).toBe(false);
  });
});
