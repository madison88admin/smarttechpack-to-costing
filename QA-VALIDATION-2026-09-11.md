# Workflow and historical costing QA

## Fix pass — September 11

- Historical reads now use stable, 500-row range pagination (up to the existing 5,000-row limit).
- Approval history includes brand/customer/season and preserves numeric zero totals. Existing snapshots are updated instead of deleted before replacement. This avoids delete-then-insert data loss but is not a database transaction covering the entire approval workflow.
- Backfilled 30 null metadata fields on 10 VPS history records, preserving existing non-null values. Readback found no remaining metadata gaps among the 11 request-linked records.
- Historical and NextGen option responses now both merge, removing the response-order overwrite.
- NextGen no longer searches only names containing `a` or truncates choices to 120. Product pages are scanned within a bounded time budget; incomplete scans are explicitly labelled partial. Upstream failures return 503 rather than a false successful empty directory.
- Verification after edits: TypeScript passed; 121 focused regression tests passed, two skipped. Added regression coverage for 2,829-row history retrieval and preserving a historical snapshot on write failure.
- Live local search/read endpoints still returned results for PBD, MD, Costing, Admin and denied Factory. The first expanded NextGen scan hit the diagnostic 60-second timeout; a bounded scan was subsequently implemented. Full PO-to-product-detail coverage is still unverified and remains outstanding. No claim of full live workflow acceptance or production deployment.

The original findings below are retained as the pre-fix baseline.

## Verdict

Not ready for final end-to-end sign-off. The checks below passed, but historical search completeness and NextGen filter population have confirmed defects. No application fixes or business-request mutations were performed in this QA pass.

## Evidence collected

- TypeScript: `npm run typecheck` passed.
- ESLint: `npm run lint` passed without warnings.
- Focused workflow regression: 18 files, 281 tests passed, 2 skipped. These use mocked dependencies and are not proof of live persistence or notification delivery.
- Chromium smoke: 3 passed (health, homepage, login form). This is not authenticated full-workflow browser coverage.
- Authenticated HTTP checks used the localhost application and configured pilot logins.
- Direct read-only database checks used the configured VPS Supabase, schema `tp_costing`.

## Live role checks

| Role | Login | Historical search / Like Styles | Notes |
| --- | --- | --- | --- |
| PBD | Passed | 200, five Acrylic results each | Nonexistent search returned zero results; import page included sidebar |
| MD | Passed | 200, five results each | Read paths only |
| Costing | Passed | 200, five results each | Read paths only |
| Admin | Passed | 200, five results each | Read paths only |
| Factory | Passed | 403 | Internal costing restriction enforced; import/admin redirected |
| Superadmin | Passed | 401 | Endpoint role policy differs from shared internal-data policy; intended access needs reconciling with user-requested admin-only workspace |
| Viewer / legacy Manager | Not tested live | Not tested live | No configured pilot entry used in this run |

HTTP 200 on an admin page was not interpreted as permission to manage users: it may render an access-denied page. Named-user audit attribution and session revocation were not validated by these checks.

## Findings

### P1: Like Styles does not read the full historical library

Database count: **2,829** records. A request for **5,000** returned **1,000**. `src/lib/costing/history.ts` uses `.limit(maxRows)` without range pagination, and Like Styles requests 5,000 through that path. Older records can therefore be excluded before scoring. Pagination must happen at the database-read layer, not just in the result UI.

### P1: Approved-history metadata is missing

Of 11 request-linked history records, 10 lack brand, customer, and season despite these being populated on their requests. This includes **CR-934999**. The approval-history writer in `src/lib/costing/actions.ts` does not populate those top-level fields; filtered history searches use those fields. Repair requires both a writer correction and a separately scoped backfill of existing data.

### P1: NextGen filter directory is incomplete

Live response counts: yarn 1, knit 0, machine 0, construction 0, category 3, factory 3, brand 9, customer 5, season 5. `src/lib/nextgen/filter-options.ts` samples products using a name search for `a`, reads a PO-line page, and caps each output at 120. This does not establish a complete PO-line-to-product directory. Failed upstream reads can also become empty arrays behind an `ok: true` response.

### P2: Filter response race can erase NextGen options

In `src/components/like-styles-search.tsx`, the historical response replaces the entire options state while the NextGen response merges into it. If historical finishes last, live options can disappear. This is a code-confirmed race; a delayed-response browser reproduction is still required.

### P2: Historical replacement is not atomic

`src/lib/costing/actions.ts` deletes previous request-linked history before inserting the replacement in a separate operation. A failed insert may leave history absent. This is a code-level failure-path finding; no destructive fault was injected against the live database.

## Cost and benchmark readback limitations

No differences were detected where the latest CBD exposed a numeric `raw_payload.grandTotal` for the comparison. This is NOT a complete independent recalculation: missing raw totals, line-based computation, currency, and revision alignment require additional checks. `master_benchmark_history` exists in the current database; older missing-table warnings should not be treated as current evidence.

## Approval, clarification, and rejection coverage

Mocked regression covers factory submission, MD technical review, Costing review, PBD decision, clarification return paths, rejection, pricing gates, and customer-status logic. It covers direct return to PBD only when required preceding reviews remain valid; invalid prerequisites must block approval.

Still required for final acceptance:

1. Use isolated, clearly tagged fixtures with actual named-user logins for Factory → MD → Costing → PBD approval.
2. Exercise MD, Costing, and PBD clarification separately, then factory edit/resubmit and verify the correct return queue.
3. Confirm rejection prevents further edits/approval and does not publish approved history.
4. Verify persisted audit actor, field-level before/after values, revision association, and duplicate-submit protection.
5. Independently recalculate an approved CBD and read it back from Historical Costing, Like Styles, benchmark, and material-library consumers.
6. Test authenticated browser pagination, quick view, clear filters, mobile layout, and delayed NextGen/historical responses.
7. Test Viewer, Manager mapping, deactivated users, changed roles, and session expiry.

Existing scripts that mint role cookies bypass real login; they should not be represented as user-acceptance testing. Live approval tests may trigger external notifications and must use an isolated test delivery destination before execution. No production app deployment or external notification delivery was verified.

## Reproducible diagnostics

- `node scripts/qa-readonly-live.mjs`: live login and read-path diagnostics; prints observations, not an assertion-based acceptance verdict.
- `node scripts/qa-history-readback.mjs`: read-only history count, capped retrieval, linked metadata, and limited snapshot comparison.

These scripts do not modify request/costing records. Login may update account login timestamps. Credentials are loaded from local configuration and are not included in this report.
