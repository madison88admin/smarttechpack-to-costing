// Pure cost-sheet-ready flag logic (no I/O). The route in
// src/app/api/costing/requests/[id]/cost-sheet-ready/route.ts applies these
// verdicts and then performs the database work (update, workflow event).

/**
 * Returns an error message when the cost-sheet-ready flag cannot be set, else
 * null. Marking a sheet ready requires the request to be internally approved.
 * Clearing the flag (ready = false) is always allowed, from any status.
 */
export function assertCostSheetReadyGate(status: string, ready: boolean): string | null {
  if (status !== "approved" && ready) {
    return "Cost sheet can only be marked ready for approved requests";
  }
  return null;
}

/**
 * Derives the update payload for the cost-sheet-ready flag. Setting it records
 * who flagged it and when; clearing it resets all three fields.
 */
export function resolveCostSheetReadyUpdates(
  ready: boolean,
  now: string,
  role: string
): Record<string, unknown> {
  return ready
    ? {
        cost_sheet_ready: true,
        cost_sheet_ready_at: now,
        cost_sheet_ready_by: role
      }
    : {
        cost_sheet_ready: false,
        cost_sheet_ready_at: null,
        cost_sheet_ready_by: null
      };
}
