import { describe, expect, it } from "vitest";
import { scopeSlaRowsForRole, type AgingRow } from "../src/lib/costing/aging";

const row = (owner_role: string): AgingRow => ({ id: owner_role, request_number: null, status: "for_pbd_review", factory_name: null, created_at: "2026-01-01", started_at: "2026-01-01", days_in_status: 2, days_since_created: 2, bucket: "fresh", is_overdue: false, sla_days: 1, style_number: null, deadline_at: null, breached_at: null, owner_role });

describe("SLA role scope", () => {
  it("only returns work owned by the current role", () => {
    const rows = [row("factory"), row("md"), row("costing"), row("pbd")];
    expect(scopeSlaRowsForRole(rows, "costing").map(item => item.owner_role)).toEqual(["costing"]);
    expect(scopeSlaRowsForRole(rows, "pbd").map(item => item.owner_role)).toEqual(["pbd"]);
    expect(scopeSlaRowsForRole(rows, "manager").map(item => item.owner_role)).toEqual(["pbd"]);
  });
});
