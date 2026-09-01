# Smart TP-to-Costing Approval Tool — Full Phase Plan

## Phase 0 — Discovery and BRD Alignment

Status: Done

- Study BRD and shorten the original process.
- Confirm `tp_costing` as the database schema.
- Confirm NextGen as source system for product/BOM/PO/MPO data.
- Confirm Supabase VPS as the application database/runtime target.
- Define short workflow:
  1. PBD searches/pulls style from NextGen.
  2. PBD creates costing request.
  3. Factory fills CBD.
  4. System validates costing.
  5. PBD clarifies, rejects, or approves.
  6. Approved costing goes to history/benchmark.

## Phase 1 — MVP Foundation

Status: Done

- Create `tp_costing` schema and core tables.
- Build Next.js application.
- Add secure backend-only NextGen proxy.
- Add product search and BOM loading.
- Add request creation.
- Add factory CBD form.
- Add validation results.
- Add PBD actions.
- Add historical costing table.
- Deploy app to VPS.

## Phase 2 — Pilot-Ready Workflow

Status: In Progress

- Add dashboard live counts and filters. Done.
- Redirect new request to detail page. Done.
- Add status-aware action buttons. Done.
- Add factory CBD edit/prefill. Done.
- Add formal costing summary and grand total. Done.
- Add audit trail with role, old status, new status, timestamp. Done.
- Add access-control foundation. Next.
- Add workflow event logs for notifications. Next.

## Phase 3 — Roles, Security, and User-Friendly Access

Status: Next

Target roles:

- Admin
- PBD / Merchandiser
- Factory
- Viewer

Deliverables:

- User role table or profile table.
- Server-side role helper.
- UI restrictions:
  - PBD/Admin can approve/reject/clarify.
  - Factory can fill CBD.
  - Viewer can only view.
- Safer handling of service credentials.
- Optional Supabase Auth integration.

## Phase 4 — Notifications and Follow-Up

Status: Pending

Deliverables:

- Event log for workflow changes.
- Notification-ready records for:
  - request sent to factory
  - factory submitted CBD
  - PBD requested clarification
  - PBD approved/rejected
- Email-ready templates.
- Future integration options:
  - SMTP
  - Microsoft Outlook
  - Slack/Teams

## Phase 5 — Reporting, Export, and Historical Benchmarking

Status: Pending

Deliverables:

- Better history search.
- Cost comparison view.
- Export approved costing to CSV/XLSX.
- Export request summary.
- Benchmark logic improvements:
  - same style
  - same factory
  - same product category
  - same currency
  - material-level comparison

## Phase 6 — AI Assist / Smart Review

Status: Pending

Deliverables:

- Auto-summary of high-risk costing.
- AI review suggestions:
  - missing cost fields
  - abnormal variance
  - unusual material cost
  - repeated clarification patterns
- Suggested PBD comment drafts.
- Historical explanation: why current costing is higher/lower.

## Phase 7 — Pilot QA and Business Testing

Status: Pending

Deliverables:

- Test with 3–5 real styles.
- Confirm NextGen product/BOM accuracy.
- Confirm factory CBD inputs.
- Confirm approval and history saving.
- Fix user feedback.
- Add basic production checklist.

## Phase 8 — Production Hardening

Status: Pending

Deliverables:

- Reverse proxy / cleaner URL.
- HTTPS.
- Backup plan.
- Error monitoring.
- Deployment rollback notes.
- Access rules tightened.
- Admin maintenance page.

## Recommended Build Order From Here

1. Finish Phase 3 role/access-control foundation.
2. Add Phase 4 workflow event logs.
3. Add Phase 5 export/reporting.
4. Add Phase 6 AI assist.
5. Run Phase 7 pilot QA.
6. Harden production in Phase 8.
