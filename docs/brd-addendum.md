# BRD Addendum — Smart Tech Pack-to-Costing Approval Tool

**Document Type:** Change Request / Addendum to approved BRD
**Date:** 2025-01-XX
**Prepared by:** Development Team
**Requires sign-off from:** Polly (Business Owner), Tyler (Project Sponsor)

---

## 1. Purpose

This document formalizes deviations and additions to the approved Business Requirements Document (BRD) for the Smart Tech Pack-to-Costing Approval Tool. The BRD was approved with an approval table in Section 15. This addendum documents:

1. **Role structure change** — addition of "Costing Team" role
2. **Scope additions** — features built beyond the original BRD scope
3. **Security review note** — AI/LLM data flow requires security governance review

---

## 2. Role Structure Change

### BRD Original (Section: Stakeholders & RBAC)
- Admin, PBD, Factory, Viewer

### Change
Added **Costing Team** role as a separate stakeholder, per BRD stakeholder design.

### Rationale
The BRD describes Costing Team as the "Process Owner" responsible for cost validation, comparative style review, and cost sheet preparation. The original implementation merged Costing + PBD functions into a single role. This addendum formalizes the separation:

| Function | Costing Team | PBD |
|----------|:-----------:|:---:|
| Cost sheet validation (checklist) | ✅ | ❌ |
| Like-style comparison recording | ✅ | ❌ |
| Compliance checks (RSL/REACH/OEKO-TEX) | ✅ | ❌ |
| Sample tracking | ✅ | ❌ |
| Material Buffer + M88 Packaging review | ✅ | ❌ |
| Cost Sheet Ready toggle (post-approval) | ✅ | ❌ |
| Material Library management | ✅ | ✅ |
| Create costing request | ❌ | ✅ |
| Send to factory | ❌ | ✅ |
| Approve / Reject / Clarify | ❌ | ✅ |
| Customer review status | ❌ | ✅ |
| Multi-Vendor RFQ | ❌ | ✅ |
| What-If Analyzer | ❌ | ✅ |

### New Workflow Status: `for_costing_review`

A new workflow status `for_costing_review` has been added to enforce the segregation of duties at the system level (not just UI permissions).

**Updated workflow (happy path):**
```
draft → sent_to_factory → [factory submits CBD] → for_costing_review → [Costing completes validation] → for_pbd_review → [PBD approves] → approved
```

**Clarification loops (both return to Costing):**
```
PBD clarification:
  for_pbd_review → [PBD clarifies] → needs_clarification → [factory resubmits] → for_costing_review (back to Costing)

Costing clarification:
  for_costing_review → [Costing clarifies] → needs_clarification → [factory resubmits] → for_costing_review (back to Costing)
```

Both clarification paths return to `for_costing_review`, ensuring Costing Team always re-validates any resubmitted CBD. This prevents bypassing the segregation of duties on the 2nd submission (BRD Section 13 risk).

> **Design note (for stakeholder awareness):** All resubmissions route through Costing regardless of clarification originator, by design, to ensure consistent re-validation. This means even when PBD requests clarification (e.g., a pricing question, not a cost validation issue), the factory's resubmission will still pass through Costing before reaching PBD again. This is intentionally conservative — it guarantees no CBD reaches PBD without Costing's sign-off. Potential cycle time impact: if PBD-clarify loops are frequent, the extra Costing checkpoint could offset some turnaround gains (OBJ-003: "≥30% improvement in approval turnaround"). Stakeholders should accept this trade-off, or a future enhancement could introduce distinct clarification states (`needs_clarification_costing` vs `needs_clarification_pbd`) to route resubmissions more precisely.

**Key changes:**
1. Factory CBD submission now sets status to `for_costing_review` (not `for_pbd_review`)
2. New action `costing_complete` moves request from `for_costing_review` → `for_pbd_review`
3. New action `costing_clarify` moves request from `for_costing_review` → `needs_clarification`
4. Resubmission from `needs_clarification` always goes to `for_costing_review` (regardless of who requested clarification)
5. PBD cannot see or act on requests in `for_costing_review` status
6. Costing Team cannot approve/reject (only validate and forward)
7. Role enforcement is at API level (403 if wrong role attempts wrong action)

### Notification Recipients

Notification recipients have been configured for all workflow events:

| Event | Recipients |
|-------|-----------|
| `factory_submit` | Costing Team, Admin |
| `costing_complete` | PBD, Costing Team, Admin |
| `costing_clarify` | Factory, Costing Team |
| `send_to_factory` | Factory |
| `clarify` (PBD) | Factory |
| `approve` | PBD, Admin |
| `reject` | PBD, Admin |
| `manager_approve` | PBD |
| `manager_reject` | PBD |

This ensures Costing Team is alerted when a new CBD arrives at `for_costing_review`, and PBD is alerted when Costing completes validation.

### Cost Sheet Ready Toggle — Post-Approval

The "Cost Sheet Ready" toggle is a **post-approval** step owned by the Costing Team:
- Only appears when status = `approved`
- Only the Costing Team role can toggle it
- Purpose: mark when the final cost sheet has been prepared in NextGen
- This is NOT a pre-approval validation step

### Segregation of Duties (OBJ-006)
This change restores the segregation of duties required by OBJ-006: Costing Team validates the cost sheet, PBD approves it. No single role can both validate and approve. The `for_costing_review` status enforces this at the database/workflow level — PBD literally cannot see or act on a request until Costing Team completes their validation and explicitly forwards it.

---

## 3. Scope Additions (Beyond BRD Section 4.2)

The following features were built beyond the original BRD scope. They are value-adds that enhance the pilot but were not in the approved scope.

### 3.1 Automated Costing Calculation Engine
- **BRD status:** Out of Scope ("Automated Costing calculation engine")
- **What was built:** Auto-calculation of FOB, landed cost, wholesale/retail price, gross margin
- **Justification:** Essential for pilot usability — manual calculation would be a significant bottleneck
- **Risk:** Low — calculations are transparent and shown to all roles

### 3.2 NextGen API Integration
- **BRD status:** "NextGen API integration unless approved separately"
- **What was built:** Product search, BOM pull, MPO/PO lookup, Material Library sync
- **Justification:** Core to the workflow — without NextGen integration, BOM data must be entered manually
- **Risk:** Medium — depends on NextGen API availability and session management

### 3.3 AI Features (Chatbot, Smart Review, Should-Cost Model)
- **BRD status:** Not mentioned in BRD
- **What was built:**
  - AI Chatbot (Qwen3:14b LLM) — answers costing questions, searches NextGen
  - Smart Review AI Enhancement — LLM-powered risk analysis and recommendations
  - Should-Cost Model — LLM estimates what a style should cost based on historical data
- **Justification:** Reduces PBD/Costing review time, provides data-driven insights
- **Risk:** HIGH — requires security review under C-005 (Madison88 security & governance standards)
  - LLM runs on VPS (5.223.78.194) — data leaves the Supabase environment
  - Costing data (factory costs, BOM, margins) is sent to the LLM
  - **Recommendation:** Review with IT Security before production deployment
  - **Mitigation:** LLM is self-hosted (not third-party API), data is not persisted by LLM

### 3.4 Multi-Vendor RFQ
- **BRD status:** Not in BRD scope
- **What was built:** Compare quotes from multiple factories for the same style
- **Justification:** Enables cost optimization and vendor comparison
- **Risk:** Low — read/write operations on dedicated `vendor_quotes` table

### 3.5 Compliance Checks (RSL/REACH/OEKO-TEX)
- **BRD status:** Not in BRD scope
- **What was built:** Track compliance status for chemical, environmental, and certification standards
- **Justification:** Required for production readiness — compliance is mandatory for apparel manufacturing
- **Risk:** Low — informational tracking only

### 3.6 Sample Tracking
- **BRD status:** Not in BRD scope
- **What was built:** Track sample rounds (proto, pre-production, shipment) with status and dates
- **Justification:** Provides visibility into the physical sampling process alongside costing
- **Risk:** Low — informational tracking only

### 3.7 Manager Approval Tier (Cost Threshold)
- **BRD status:** Not mentioned in BR-006 (Costing→PBD routing only)
- **What was built:** Automatic routing to manager approval when cost exceeds configurable threshold
- **Justification:** Adds governance for high-value costings — standard practice in apparel industry
- **Risk:** Low — threshold is configurable in Admin Settings

### 3.8 Material Library Sync from NextGen
- **BRD status:** Not in BRD scope
- **What was built:** One-click sync of all BOM materials from NextGen into reusable material library
- **Justification:** Eliminates manual data entry, ensures material costs are standardized
- **Risk:** Low — read-only from NextGen, write to local material_library table

---

## 4. Partially Implemented Requirements (Now Addressed)

| BRD Requirement | Original Gap | Resolution |
|----------------|-------------|------------|
| BR-017/BR-019: Like Styles auto-recommendation | Manual entry only | Automated matching by yarn/knit/machine type with match score |
| BR-014/BR-015: Benchmarks by Yarn/Knit/Machine | Generic benchmark | Attribute-based benchmark panel added |
| BR-010: Dashboard aging analysis | Missing | Aging/SLA widget with Fresh/Aging/Overdue buckets + SLA alert table |
| BR-008: Customer review stages (plural) | Single auto-transition | 6-state lifecycle with visual timeline |
| BR-002: Material Buffer, M88 Packaging | Implicit in "etc." | Explicit labeled fields in CBD wizard |
| NFR - Data Quality (duplicate prevention) | Missing | Duplicate detection on create with override option |

---

## 5. Security Review Required

Per C-005 (Madison88 security & governance standards), the following items require formal security review before production deployment:

1. **AI/LLM Data Flow** — Costing data (BOM, factory costs, margins) is sent to Qwen3 LLM on VPS
   - VPS: 5.223.78.194
   - Data includes: material costs, labor, overhead, FOB, landed cost, margins
   - LLM does not persist data (stateless inference)
   - **Action:** Review with IT Security team

2. **NextGen API Session** — Session cookie is cached server-side
   - Session is stored in memory with TTL
   - No credentials are stored in the database
   - **Action:** Verify session management meets security standards

3. **Service Role Key** — Supabase service_role key is used for all database operations
   - Bypasses RLS (Row Level Security)
   - RLS is disabled on operational tables for service_role access
   - **Action:** Review RLS strategy for production deployment

---

## 6. Approval

By signing below, the stakeholders acknowledge the deviations and additions documented in this addendum:

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Business Owner | Polly | __________ | _____ |
| Project Sponsor | Tyler | __________ | _____ |
| IT Security | __________ | __________ | _____ |

---

*This addendum should be filed alongside the original BRD as part of the project documentation.*
