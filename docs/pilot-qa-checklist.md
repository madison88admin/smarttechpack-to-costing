# Phase 7 Pilot QA Checklist

Use this checklist for 3–5 real styles before production hardening.

## Test Data

Recommended pilot styles (all confirmed to have real BOMs in NextGen on 2026-08-03):

- `M88118568` — ProductId `32514`, 8 BOM lines (yarn, fleece lining, logo label, 5 packaging items).
- `M8836232` — ProductId `12962`, 8 BOM lines (2 yarn, 1 logo brand, 5 packaging).

`M8819347` (ProductId 327) has **0 BOM rows** — use it only for product-search testing, not BOM testing.

Add 2–4 more real styles from active costing work. To verify a style has a BOM before pilot testing, run:

```txt
GET /api/product/{entityId}/bom
GET /api/product/{entityId}/bom/diagnostics
```

Or use the flexible BOM search:

```txt
GET /api/nextgen/bom/search?styleNumber=M88118568
```

If `data` is empty and `total` is 0, pick a different style. Note: the ViewCache fallback can report false negatives (saying "No items" when BOM rows actually exist), so always trust the primary endpoint result over the ViewCache warning.

## End-to-End Flow

### 1. NextGen Product Search

- Open Create Request.
- Search style number.
- Confirm product result is returned.
- Confirm style/product name looks correct.
- Select product.

Pass criteria:

- Product search returns expected style.
- User can select one product without confusion.

### 2. BOM Load

- Click Load BOM.
- Confirm BOM lines load when available.
- If no BOM lines exist, confirm message is clear.

Pass criteria:

- BOM data is visible or empty-state explanation is clear.

### 3. Create Costing Request

- Fill factory name.
- Add optional notes.
- Create draft.
- Confirm app redirects to request detail.

Pass criteria:

- Request saves to `tp_costing.costing_requests`.
- Request detail opens after save.
- Dashboard shows new request.

### 4. Send to Factory

- From request detail, click Send to Factory.
- Confirm status changes to Sent to Factory.
- Confirm activity/audit trail shows old status → new status.

Pass criteria:

- Status transition is recorded in Activity.
- `approval_actions` has transition data.

### 5. Factory CBD Input

- Open Factory CBD page.
- Confirm BOM lines are prefilled.
- Fill unit costs, labor, overhead, margin.
- Confirm estimated material total changes while typing.
- Save Draft.
- Reload page and confirm previous values are still visible.

Pass criteria:

- CBD draft persists.
- Material total estimate is understandable.

### 6. Submit to PBD

- Submit CBD to PBD.
- Confirm status becomes For PBD Review or Needs Clarification.
- Confirm validation issues are shown when required fields are missing.

Pass criteria:

- Validation logic catches missing/invalid costs.
- Activity trail records Factory submit.

### 7. Smart Review

- Open request detail after CBD submit.
- Review Smart Cost Review panel.
- Confirm risk level makes sense.
- Confirm suggested PBD action/comment is useful.

Pass criteria:

- Smart review is understandable for PBD.
- Top cost drivers/benchmark comments are useful.

### 8. PBD Clarify / Approve

- If validation has errors, try Approve and confirm it is blocked.
- Add clarification comment and click Clarify.
- Confirm factory page shows clarification request.
- Correct CBD and resubmit.
- Approve when clean.

Pass criteria:

- Approval is blocked when validation errors exist.
- Clarification loop is clear.
- Approved costing saves to historical library.

### 9. Historical Costing and Export

- Open Historical Costing.
- Search approved style/factory.
- Export CSV.
- Confirm CSV downloads with expected headers/data.

Pass criteria:

- Approved costing appears in history.
- Export works.

## Pilot Sign-Off

Mark each item:

- Product search
- BOM load
- Request creation
- Factory CBD
- Validation
- Smart review
- PBD approval
- Historical save
- CSV export

Production hardening can start after all pilot items pass for at least 3 real styles.
