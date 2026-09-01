# Smart Tech Pack-to-Costing Approval Tool
## End-to-End User Flow (Detailed)

> **Workflow v2:** See [`approval-workflow-v2.md`](approval-workflow-v2.md) for the
> current canonical process. MD review, RSL/REACH compliance gates, PBD pricing
> ownership, and the customer revision loop are now explicit.

> **Scope:** This document covers the complete workflow for end users only — PBD, Costing Team, Factory, and Manager roles. Admin/Superadmin functions (system configuration, user management, currency rates, checklist configuration) are excluded.

---

## Overview

The system reduces manual costing cycles by pulling style, BOM, PO, and MPO data from NextGen, then letting factories fill in the missing cost details. The workflow enforces **segregation of duties**: PBD creates and approves, Costing Team validates, Factory submits cost data, and Manager handles high-cost exceptions.

### Roles at a Glance

| Role | Full Name | Primary Responsibility |
|------|-----------|----------------------|
| **PBD** | Product Business Developer | Creates requests, sends to factory, enters selling price, normal internal approval, customer lifecycle |
| **Costing Team** | Costing Validator | Validates factory CBD, completes checklist, requests clarification |
| **Factory** | Factory User | Fills in and submits the Cost Breakdown Data (CBD) |
| **Manager** | Approving Manager | Approves/rejects high-cost requests above threshold |
| **MD** | Merchandising Reviewer | Reviews yarn, knit, machine, and construction before PBD approval |

### SLA Timelines (in hours)

| Stage | SLA | Owner |
|-------|-----|-------|
| Factory CBD submission | 36 hours | Factory |
| Costing team validation | 24 hours | Costing Team |
| PBD selling price entry | 24 hours | PBD |

---

## Status Flow Diagram

```
                        ┌──────────────────────────────────────────┐
                        │                                          │
                        ▼                                          │
   ┌─────────┐    ┌───────────────┐    ┌──────────────────┐    │    │
   │  DRAFT  │───▶│ SENT_TO_FACTORY│───▶│ FOR_COSTING_REVIEW│   │    │
   └─────────┘    └───────────────┘    └──────────────────┘    │    │
                        ▲                     │                │    │
                        │                     ▼                │    │
                        │              ┌──────────────┐        │    │
                        │              │FOR_PBD_REVIEW│        │    │
                        │              └──────────────┘        │    │
                        │                     │                │    │
                        │           ┌─────────┼─────────┐      │    │
                        │           ▼         ▼         ▼      │    │
                        │     ┌──────────┐ ┌──────┐ ┌───────┐  │    │
                        │     │PENDING_  │ │APPROVED│ │REJECTED│ │    │
                        │     │MANAGER_  │ └──────┘ └───────┘  │    │
                        │     │APPROVAL  │      ▲              │    │
                        │     └──────────┘      │              │    │
                        │        │  │           │              │    │
                        │   ┌────┘  └────┐      │              │    │
                        │   ▼            ▼      │              │    │
                        │ APPROVED    REJECTED  │              │    │
                        │                          │              │    │
                        │     ┌───────────────────────┐         │    │
                        └─────│  NEEDS_CLARIFICATION   │◀────────┘    │
                              └───────────────────────┘              │
                                      ▲                               │
                                      └───────────────────────────────┘
                                    (Factory resubmits after clarification)
```

---

## STEP 1: Request Creation (PBD)

**Who:** PBD
**Status:** `draft`
**Page:** `/requests/new`

### What Happens:
1. PBD navigates to `/requests/new`
2. Searches NextGen by **style number**, **PO number**, or **MPO number**
3. Backend proxy logs in to NextGen using server-side credentials
4. System fetches from NextGen:
   - Product details (style number, product name)
   - BOM material lines (material name, category, consumption, UOM)
   - PO/MPO references
5. PBD reviews the prefilled data
6. PBD clicks **"Create Request"**

### Data Captured:
| Field | Source | Required |
|-------|--------|----------|
| Style number | NextGen | ✅ |
| Product name | NextGen | ✅ |
| BOM lines | NextGen | ✅ |
| Factory name | PBD input | Optional |
| Customer name | NextGen | Optional |
| Season | NextGen | Optional |

### Result:
- Request created in `draft` status
- Request number auto-generated (e.g., `CR-560926`)
- Workflow event recorded

---

## STEP 2: Send to Factory (PBD)

**Who:** PBD
**Status:** `draft` → `sent_to_factory`
**Page:** `/requests/[id]`

### What Happens:
1. PBD opens the request detail page
2. Reviews the request summary (style, BOM, factory)
3. Clicks **"Send to Factory"** button
4. Confirmation dialog appears
5. PBD confirms

### Validations:
- Status must be `draft`
- Role must be PBD (or Admin tier)

### Result:
- Status changes to `sent_to_factory`
- Factory can now access the request at `/factory/[requestId]`
- Workflow event + approval action recorded
- SLA timer starts (36 hours for factory submission)

### Notifications:
- Factory notified that a new CBD is pending

---

## STEP 3: Factory CBD Submission (Factory)

**Who:** Factory
**Status:** `sent_to_factory` → `for_costing_review`
**Page:** `/factory/[requestId]`

### What Happens:
1. Factory opens the request link
2. Sees the **7-step CBD wizard form** (matches Excel template):

### The 7-Step CBD Form:

#### Step 1: Header Info
| Field | Example |
|-------|---------|
| Customer | VANS |
| Season | F27 |
| Style # | VN0013RS |
| Style Name | New Wide Cuff Beanie |
| Costed Qty | 2800 pcs / 600 pcs |
| Lead Time (days) | 130 |
| Finish Weight | 98gr |
| Proto Version | P1, P2, P2 REMAKE |

#### Step 2: Yarn
- Dynamic rows: **Yarn Name**, **Consumption (g)**, **Material Price (USD/kg)**
- **"Calc Price" button** — shows computation breakdown:
  - FOB Price (USD/kg)
  - Surcharge (%)
  - Freight (USD/kg)
  - Markup (%)
  - **Auto-computed:** `Material Price = ((FOB × (1 + Surcharge%)) + Freight) × (1 + Markup%)`
  - **Auto-computed:** `Material Cost = Consumption(g) / 1000 × Material Price`
- Yarn Notes (FOB, CIF, MCQ, MOQ, surcharge details)

#### Step 3: Fabric & Trim
- **Fabric rows:** Name, Consumption (yards), Material Price (USD/yd), auto-computed Material Cost
- **Trim rows:** Name, Consumption (piece), Material Price (USD/pc), auto-computed Material Cost
- Subtotal: **Total Material & Submaterials** (Yarn + Fabric + Trim)

#### Step 4: Knitting & Operations
- **Knitting rows:** Machine Type (dropdown with standard costs), Knitting Time (mins), SAH (USD/min)
  - **Auto-computed:** `Knitting Cost = Knitting Time × SAH`
  - Reference options: Scripto, Circular (AZE/Jacquard), Flat-12GG, Flat-10GG, Flat-9GG, Flat-7GG, Flat-5GG, Flat-3.5GG, Flat-3GG, Hand Knit
- **Operations rows:** Operation (dropdown), Operation Cost (USD)
  - Reference options: Labeling, Linking Beanie (various), Hand Closing, Neaten/Steaming/Packing, Washing, Cutting, Overlock, Overhead, Lining attachment, Yarn poms, Faux Fur Poms

#### Step 5: Packaging & Overhead/Profit
- **Standard Packaging Cost** (USD)
- **Special Packaging Cost** (USD)
- **Overhead** (USD)
- **Profit** (USD)
- **Live total:** `TOTAL FACTORY COST = Material + Knitting + Operations + Packaging + Overhead + Profit`

#### Step 6: Notes
- Factory Notes (general)
- Costing Notes / Learnings
- Recurring Issue Tags (comma-separated)

#### Step 7: Review & Submit
- Summary of all sections with totals
- **"Save Draft"** button — saves without submitting
- **"Submit to Costing"** button — submits for review

### Validations on Submit:

**Errors (block submission → goes to `needs_clarification`):**
- Missing currency
- Missing material name
- Missing or invalid unit cost
- Negative consumption

**Warnings (do not block → goes to `for_costing_review`):**
- Missing labor/operations cost
- Missing overhead
- Missing MOQ
- Missing lead time
- Missing material buffer
- Missing packaging cost
- Missing testing cost
- Missing brand-nominated items
- Missing yarn/knit/machine type (affects benchmarking)
- No material lines submitted

### Benchmark Variance Check:
- System compares factory cost vs. historical average for same style/factory
- If variance > configurable threshold (default 15%) → warning generated
- Historical data pulled from `historical_costings` table

### Result:
- CBD saved to `factory_cbds` table with structured data in `raw_payload`
- Line items saved to `cbd_material_lines` table with `section` tags (yarn, fabric, trim, knitting, operations)
- If no blocking errors → status changes to `for_costing_review`
- If blocking errors → status changes to `needs_clarification`
- Validation results saved to `validation_results` table
- Workflow event + approval action recorded
- SLA timer resets (24 hours for costing validation)

---

## STEP 4: Costing Team Validation (Costing Team)

**Who:** Costing Team
**Status:** `for_costing_review` → `for_pbd_review` OR `needs_clarification`
**Page:** `/requests/[id]`

### What Happens:
1. Costing Team opens the request detail page
2. Reviews the following sections:

### Sections Available:

#### A. Costing Summary (Excel-matching format)
```
Yarn                          USD X.XXXXX
Fabric                        USD X.XXXXX
Trim                          USD X.XXXXX
Total Material & Submaterials USD X.XXXXX
Knitting                      USD X.XX
Operations                    USD X.XX
Packaging (Std + Special)     USD X.XX
Overhead                      USD X.XX
Profit                        USD X.XX
═════════════════════════════
TOTAL FACTORY COST            USD X.XXXXX
```

#### B. Validation Results
- List of all validation issues (errors and warnings)
- Each issue shows: severity, rule code, message, field path

#### C. Validation Checklist
**4 Required items (red badge — must be checked to proceed):**
1. ☐ MOQ checked
2. ☐ Lead time checked
3. ☐ Packaging checked
4. ☐ Comparable style reviewed

**3 Optional items (blue badge — can be skipped):**
5. ☐ Brand-nominated supplier/items checked
6. ☐ Material buffer checked
7. ☐ Testing cost checked

- Progress counter shown: "X/4 required items checked"
- Each item can have a comment
- Click **"Save Checklist"** to save progress

#### D. Benchmark Comparison
- Historical average for same style/factory
- Variance percentage
- Sample size
- Like styles (similar products)

#### E. Smart Review Alerts
- AI-powered anomaly detection
- Cost outlier warnings
- Missing field alerts

#### F. Costing Notes
- Notes from previous requests
- Learnings tagged with recurring issue tags

### Actions Available:

| Action | Button | Result |
|--------|--------|--------|
| **Complete Validation** | "Complete Validation" | Status → `for_pbd_review` |
| **Request Factory Clarification** | "Request Clarification" | Status → `needs_clarification` |

### Validations Before "Complete Validation":
- **All 4 required checklist items** must be checked
- **No blocking validation errors** (severity: "error")
- If either fails → action blocked with error message

### Result of "Complete Validation":
- Status changes to `for_pbd_review`
- Workflow event + approval action recorded
- SLA timer resets (24 hours for PBD review)

### Result of "Request Clarification":
- Status changes to `needs_clarification`
- Clarification comment saved to approval_actions
- Factory notified of clarification needed
- Request goes back to factory (Step 3)

---

## STEP 5: PBD Review & Approval (PBD)

**Who:** PBD
**Status:** `for_pbd_review` → `approved` OR `pending_manager_approval` OR `needs_clarification` OR `rejected`
**Page:** `/requests/[id]`

### What Happens:
1. PBD opens the request detail page
2. Reviews all sections (same as Costing Team, plus):
   - Costing Team's checklist completion
   - Validation results
   - Benchmark data
   - Smart review alerts
3. PBD enters selling price data (if applicable):
   - Landed cost components (freight, duty, insurance, customs, inland transport)
   - Wholesale markup
   - Retail markup
4. PBD chooses an action:

### Actions Available:

| Action | Button | Result |
|--------|--------|--------|
| **Approve** | "Approve" | Status → `approved` OR `pending_manager_approval` |
| **Clarify** | "Clarify" | Status → `needs_clarification` |
| **Reject** | "Reject" | Status → `rejected` |

### Manager Approval Threshold Check:
When PBD clicks "Approve":
1. System checks if total cost > `manager_approval_threshold` (configurable)
2. If cost **≤ threshold** → status changes to `approved` directly
3. If cost **> threshold** → status changes to `pending_manager_approval`
   - Manager notified to review
   - Uses landed cost if available, otherwise factory cost total

### Validations Before Approval:
- **All 4 required checklist items** must be checked
- **No blocking validation errors** (severity: "error")

### Result of "Approve" (direct):
- Status changes to `approved`
- CBD data saved to `historical_costings` table for future benchmarking
- Customer status auto-set to `pending_customer_submission`
- Workflow event + approval action recorded

### Result of "Clarify":
- Status changes to `needs_clarification`
- Clarification comment saved
- Factory notified
- Request goes back to factory (Step 3)

### Result of "Reject":
- Status changes to `rejected`
- Rejection reason saved
- Factory notified
- Request is closed

---

## STEP 6: Manager Approval (Manager) — Conditional

**Who:** Manager (Aci and Lovely)
**Status:** `pending_manager_approval` → `approved` OR `rejected`
**Page:** `/requests/[id]`

### When This Step Happens:
- Only when the total cost exceeds the **manager approval threshold**
- PBD approval routes here instead of direct approval

### What Happens:
1. Manager opens the request detail page
2. Reviews:
   - CBD totals and breakdown
   - PBD's approval notes
   - Validation checklist
   - Benchmark data
3. Manager chooses an action:

### Actions Available:

| Action | Button | Result |
|--------|--------|--------|
| **Manager Approve** | "Manager Approve" | Status → `approved` |
| **Manager Reject** | "Manager Reject" | Status → `rejected` |

### Result of "Manager Approve":
- Status changes to `approved`
- CBD data saved to `historical_costings` table
- Customer status auto-set to `pending_customer_submission`
- Workflow event + approval action recorded

### Result of "Manager Reject":
- Status changes to `rejected`
- Request is closed

---

## STEP 7: Approved — Historical Save (System)

**Who:** System (automatic)
**Status:** `approved`

### What Happens Automatically:
1. CBD data saved to `historical_costings` table:
   - Style number, factory name
   - Total cost and currency
   - Yarn type, knit type, machine type, construction, product category
   - Average consumption, knitting time
   - Searchable text for future benchmarking
   - Full raw payload (request + CBD + totals)
2. Customer status advanced to `pending_customer_submission`
3. Request is now available as a benchmark for future requests

### Post-Approval Actions Available:

| Action | Who | Description |
|--------|-----|-------------|
| **Mark Cost Sheet Ready** | Costing Team | Sets `cost_sheet_ready` flag, status remains `approved` |
| **Bulk Mark Cost Sheet Ready** | Costing Team | Mark multiple approved requests as cost sheet ready |

---

## Clarification Loop (Steps 3-4-5)

When a request goes to `needs_clarification`, the following loop occurs:

```
Factory submits CBD
       │
       ▼
Costing Team reviews
       │
       ├── Issue found ──▶ "Request Clarification" ──▶ needs_clarification
       │                                                    │
       │                                                    ▼
       │                                            Factory sees clarification
       │                                            Factory edits & resubmits
       │                                                    │
       │                                                    ▼
       │                                            for_costing_review
       │                                            (back to Costing Team)
       │
       └── No issues ──▶ "Complete Validation" ──▶ for_pbd_review
                                                         │
                                                         ├── Issue ──▶ "Clarify" ──▶ needs_clarification
                                                         │
                                                         └── Approve ──▶ approved (or manager approval)
```

### Key Rules for Clarification:
- Only the **Factory** can edit the CBD (maintains audit trail)
- Costing/PBD **cannot** make direct edits for minor corrections
- Each clarification cycle creates a new CBD version
- All clarification comments are saved in the audit trail
- The clarification comment from Costing/PBD is visible to the Factory

---

## Compliance Check (RSL/REACH)

### When:
- During Costing Team validation (Step 4)

### What:
- System checks compliance status (RSL/REACH) for the style
- If compliance check **fails** → approval is **automatically blocked**
- Compliance data fetched from NextGen or stored locally

### Impact:
- PBD cannot approve if compliance failed
- Manager cannot approve if compliance failed
- Request stays in `for_pbd_review` until compliance passes or is overridden by Admin

---

## SLA & Escalation Process

### SLA Timers:

| Status | SLA | Owner |
|--------|-----|-------|
| `draft` | 36 hours | PBD (to send to factory) |
| `sent_to_factory` | 36 hours | Factory (to submit CBD) |
| `needs_clarification` | 36 hours | Factory (to resubmit) |
| `for_costing_review` | 24 hours | Costing Team (to validate) |
| `for_pbd_review` | 24 hours | PBD (to approve/reject) |
| `pending_manager_approval` | 24 hours | Manager (to approve/reject) |

### Escalation Process:
1. Cron job runs periodically (configurable interval)
2. Checks all requests in active statuses
3. Calculates days in current status from `updated_at` timestamp
4. **Reminder** sent when: `days >= SLA - 1` and `days < SLA + escalationDays`
5. **Escalation** sent when: `days >= SLA + escalationDays`
6. Duplicate prevention: no reminder within 1 day, no escalation within 2 days
7. Notifications enqueued to `notification_queue` table

### Notification Channels:
- **Email** (via Microsoft Graph API or SMTP)
- **Teams** (via webhook)
- Configurable per event type and role

---

## Dashboard Visibility by Role

### PBD Dashboard
| Metric | Description |
|--------|-------------|
| Draft Requests | Requests not yet sent to factory |
| Sent to Factory | Awaiting factory CBD |
| For Costing Review | Awaiting costing team validation |
| For PBD Review | Awaiting PBD approval |
| Needs Clarification | Returned for clarification |
| Pending Manager Approval | High-cost requests awaiting manager |
| Approved | Completed requests |
| Rejected | Rejected requests |

### Costing Team Dashboard
| Metric | Description |
|--------|-------------|
| For Costing Review | Requests awaiting validation |
| For PBD Review | Requests validated and sent to PBD |
| Needs Clarification | Requests returned to factory |
| Approved | Completed requests |
| Aging Analysis | Fresh (0-2d), Aging (3-5d), Overdue |

### Factory Dashboard
| Metric | Description |
|--------|-------------|
| Sent to Factory | New CBD requests to fill |
| Needs Clarification | Requests returned for correction |
| Approved | Completed requests |
| Rejected | Rejected requests |

### Manager Dashboard
| Metric | Description |
|--------|-------------|
| Pending Manager Approval | High-cost requests awaiting approval |
| Approved | Completed requests |
| Rejected | Rejected requests |

---

## Bulk Actions

### PBD Bulk Actions:
| Action | Description | Max Batch |
|--------|-------------|-----------|
| **Bulk Send to Factory** | Send multiple draft requests to factory | 50 |
| **Bulk Approve** | Approve multiple requests in `for_pbd_review` | 50 |

### Costing Team Bulk Actions:
| Action | Description | Max Batch |
|--------|-------------|-----------|
| **Bulk Mark Cost Sheet Ready** | Mark multiple approved requests as cost sheet ready | 50 |

### Bulk Action Validations:
- All individual validations apply to each request in the batch
- Results returned per request: `{ id, requestNumber, ok, error? }`
- Success/fail counts displayed
- Each action recorded in audit trail

---

## Audit Trail

### Every Action Records:

| Record Type | Table | Content |
|-------------|-------|---------|
| **Approval Action** | `approval_actions` | actor_role, action, from_status, to_status, comment, metadata |
| **Workflow Event** | `workflow_events` | event_type, actor_role, payload, notification_status |
| **Validation Results** | `validation_results` | severity, rule_code, message, field_path, resolved_at |
| **Checklist Results** | `request_checklist_results` | checklist_code, is_checked, comment, checked_by_role, checked_at |
| **CBD Versions** | `factory_cbds` | Each submission creates a new CBD record (versioned) |
| **Material Lines** | `cbd_material_lines` | section, material_name, consumption, unit_cost, total_cost |

### User Identity in Audit:
- All actions record the **actual user** (from cookie `tp_costing_user`), not just the role
- This ensures accountability across the team

---

## Data Flow Summary

```
NextGen API
    │
    ├── Product search (style, PO, MPO)
    ├── BOM lines (material, category, consumption)
    └── PO/MPO references
         │
         ▼
    Costing Request (draft)
         │
         ▼
    Factory CBD Form (7 steps)
    ├── Header info
    ├── Yarn lines (with FOB computation)
    ├── Fabric & Trim lines
    ├── Knitting lines (with standard costs)
    ├── Operations lines (with standard costs)
    ├── Packaging & Overhead/Profit
    └── Notes & learnings
         │
         ▼
    Validation Engine
    ├── Field validation (errors/warnings)
    ├── Benchmark variance check
    └── Compliance check (RSL/REACH)
         │
         ▼
    Costing Team Review
    ├── Costing Summary (Excel format)
    ├── Validation checklist (4 required, 3 optional)
    ├── Benchmark comparison
    └── Smart review alerts
         │
         ▼
    PBD Review
    ├── Landed cost entry
    ├── Pricing & margin
    ├── Final approval
    └── Manager routing (if high cost)
         │
         ▼
    Historical Costing (approved)
    └── Available for future benchmarking
```

---

## Key Tables Reference

| Table | Purpose |
|-------|---------|
| `costing_requests` | Main request records |
| `factory_cbds` | Factory CBD submissions (versioned) |
| `cbd_material_lines` | Individual CBD line items with section tags |
| `validation_results` | Validation issues per request |
| `approval_actions` | Audit trail of all workflow actions |
| `workflow_events` | Event log for notifications |
| `request_checklist_results` | Checklist completion status |
| `validation_checklist_items` | Checklist item definitions |
| `historical_costings` | Approved costings for benchmarking |
| `notification_queue` | Pending/sent/failed notifications |
| `workflow_settings` | SLA, thresholds, notification config |
