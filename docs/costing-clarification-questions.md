# Costing Process Flow — Clarification Questions

## Context

**System:** Smart Tech Pack-to-Costing Approval Tool (TP Costing)
**Purpose:** Digital costing workflow from NextGen tech pack pull → factory CBD submission → costing validation → PBD approval → customer review.

**Kasalukuyang Workflow:**
```
PBD creates request (draft)
  → PBD sends to factory (sent_to_factory)
    → Factory fills CBD form: materials w/ unit costs, labor, overhead, profit margin,
      MOQ, lead time, landed cost, construction details (for_costing_review)
      → Costing Team validates: checklist, compliance, benchmark, should-cost
        → Costing Complete → PBD review (for_pbd_review)
          → PBD approves (approved) or rejects (rejected) or clarifies (needs_clarification)
            → Customer review (PBD updates customer status timeline)
```

**Roles (segregation of duties):**
- **PBD** — creates requests, sends to factory, approves/rejects, customer liaison
- **Costing Team** — validates CBD, runs checklist, compliance, benchmark, completes or clarifies
- **Factory** — submits CBD only
- **Admin/Super Admin** — oversight, can do everything
- **Viewer** — read-only

**Bakit ito ginawa:** Ang mga tanong na ito ay mula sa pag-aaral ng kasalukuyang code implementation. Maraming assumptions ang ginawa ng system na kailangan ng confirmation mula sa Costing Team at PBD para matiyak na tama ang process flow at walang missing steps o maling logic.

**Paano gamitin ang dokumentong ito:**
- Each section has **Context** (what the system currently does) at **Questions** (what we need to confirm)
- Markahan ang sagot sa bawat tanong (✅ confirmed / ❌ needs change / ➕ add new)
- Pagkatapos, i-update ang implementation base sa mga sagot

---

## 1. Costing Team Validation — Ano ang exact sinusuri ng Costing?

### Context
Kapag nag-submit ang factory ng CBD, ang request ay pumunta sa `for_costing_review` status. Ang Costing Team ay makakakita ng:
- **CBD data (read-only)** — materials, unit costs, labor, overhead, profit margin, landed cost
- **Validation checklist** — 7 default items: MOQ checked, lead time checked, packaging checked, brand-nominated supplier checked, material buffer checked, comparable style reviewed, testing cost checked
- **Compliance panel** — RSL, DPP, REACH, OEKO-TEX, GOTS, Carbon checks
- **Style comparisons** — like-style, historical, vendor quote comparisons
- **Should-cost estimate** — AI-powered estimate based on product attributes
- **Cost-sheet-ready toggle** — flag na ready na ang cost sheet

Ang Costing Team ay may dalawang actions:
- **"Complete Validation"** → sends to PBD for approval (`for_pbd_review`)
- **"Request Factory Clarification"** → sends back to factory (`needs_clarification`)

**Kasalukuyang behavior:** Hindi naka-enforce na lahat ng checklist items ay checked bago mag-complete. Pwedeng i-click ang "Complete Validation" kahit walang laman ang checklist.

### Questions

- **Q1.1** Ano ang exact checklist na sinusuri ng Costing Team bago i-click ang "Complete Validation"? Yung 7 default items (MOQ, lead time, packaging, nominated supplier, material buffer, comparable style, testing cost) — tama na ba ito o may additional items na dapat idagdag?
- **Q1.2** Required ba na lahat ng 7 checklist items ay checked bago magawa ang "Complete Validation"? Sa current code, hindi naka-enforce — pwedeng mag-complete kahit hindi pa lahat checked. Dapat ba itong i-enforce?
- **Q1.3** May minimum compliance checks na required bago ma-complete ang validation? Halimbawa, dapat ba ay may at least 1 RSL check na "passed" bago pwedeng i-complete?
- **Q1.4** Kailangan ba ng Costing Team na mag-input ng sarili nilang cost adjustments o corrections sa CBD? Sa current flow, read-only ang CBD para sa Costing — hindi sila pwedeng mag-edit ng unit costs o labor/overhead. Tama ba ito, o dapat may ability silang mag-override o mag-suggest ng corrections?

---

## 2. Costing Clarify vs PBD Clarify — Ano ang difference?

### Context
Parehong pwedeng mag-send ng request pabalik sa factory ang Costing Team at PBD:
- **Costing Clarify** (`costing_clarify`) — available kapag `for_costing_review` status. Costing Team clicks "Request Factory Clarification" with a comment.
- **PBD Clarify** (`clarify`) — available kapag `for_pbd_review` o `needs_clarification` status. PBD clicks "Clarify" with a comment.

Pareho silang nagde-derive sa `needs_clarification` status. Ang factory ay makakakita ng clarification comment at pwedeng mag-re-submit ng CBD.

**Kasalukuyang behavior:** Walang functional difference sa system — parehong status, parehong notification, parehong SLA. Ang tanging pagkakaiba ay ang `actor_role` sa audit log (`costing` vs `pbd`).

### Questions

- **Q2.1** Ano ang functional difference between "Costing Clarify" at "PBD Clarify"? Pareho lang ba sila na nagde-derive sa `needs_clarification` status, o may iba pang implication (e.g., different required fields, different notification, different SLA)?
- **Q2.2** Kapag Costing nag-send ng clarification, sino ang nakakatanggap ng notification — factory lang ba, o PBD din?
- **Q2.3** May limit ba kung ilang beses pwedeng mag-clarify ang Costing bago mag-decide na i-reject na lang?

---

## 3. Validation Issues — Error vs Warning

### Context
Kapag nag-submit ang factory ng CBD, ang system ay nag-run ng `validateFactoryCbd()` na nagge-generate ng validation issues na may 3 severity levels:

| Severity | Examples | Blocks Approval? |
|----------|----------|:----------------:|
| **error** | Missing currency, missing material name, missing/zero unit cost, negative consumption | ✅ Yes |
| **warning** | Missing labor cost, missing overhead, missing MOQ, missing lead time, missing packaging, missing testing, missing brand-nominated items, missing M88 packaging, missing yarn/knit/machine type, no material lines | ❌ No |
| **info** | Low historical variance (CBD below average) | ❌ No |

Ang PBD approval ay naka-block lang kapag may unresolved `error`-level issue sa `validation_results` table (via `assertApprovalAllowed()`).

**Kasalukuyang behavior:** Ang "missing labor cost" at "missing MOQ" ay warning lang — pwedeng mag-approve kahit wala ang mga ito. Walang "resolve" button sa UI — ang validation results ay auto-generated sa bawat CBD submission.

### Questions

- **Q3.1** Tama ba na ang "missing unit cost" at "missing material name" ay `error` level (blocks approval), habang ang "missing labor cost", "missing MOQ", "missing lead time" ay `warning` lang? Dapat ba ang ilan sa mga warnings ay i-escalate sa error?
- **Q3.2** May scenario ba kung saan pwedeng mag-approve ang PBD kahit may error-level validation issue? Halimbawa, may manual override ba para sa admin/superadmin?
- **Q3.3** Sino ang nag-reresolve ng validation issues? May "resolve" button ba sa UI, o auto-resolve kapag na-fix ng factory sa re-submission?

---

## 4. Historical Benchmark — Paano ginagamit?

### Context
Kapag na-approve ang isang costing request, ang CBD data ay auto-save sa `historical_costings` table (style number, factory name, total cost, currency, yarn type, knit type, machine type, construction, product category, average consumption, knitting time). Ito ay ginagamit para sa future benchmark matching.

Kapag nag-review ang Costing Team ng bagong request, ang system ay:
1. Naghahanap ng historical costings na pareho ang style number o factory name
2. Nagfi-filter ng same currency
3. Nagco-compute ng historical average cost
4. Nagco-compute ng variance percent: `((currentTotal - historicalAverage) / historicalAverage) * 100`
5. Kapag variance > 15%, nagge-generate ng warning: "CBD total is X% above historical average"

**Kasalukuyang behavior:**
- Ang 15% threshold ay hardcoded sa `validateBenchmarkVariance()`
- Ang matching ay based lang sa style number + factory name + currency
- Kapag walang historical data (sample size = 0), walang benchmark na nagpapakita
- Walang required action kapag may high variance — read-only warning lang

### Questions

- **Q4.1** Ang 15% variance threshold — tama ba ito, o dapat mag-iba per category/style/factory? May setting ba dapat para dito sa admin settings?
- **Q4.2** Ano ang ginagawa ng Costing Team kapag may high variance warning? May required action ba (e.g., dapat mag-add ng comment explaining the variance), o read-only lang ang warning?
- **Q4.3** Ang benchmark matching — based lang ba sa style number + factory name? Dapat ba ring i-consider ang yarn type, knit type, o product category para sa mas accurate na comparison?
- **Q4.4** Kapag walang historical data pa para sa style/factory (sample size = 0), ano ang expected behavior ng Costing Team? May fallback process ba?

---

## 5. Should-Cost Estimate — Paano ito ginagamit sa decision?

### Context
Ang Should-Cost Panel ay available sa request detail page (Tracking tab). Ang Costing Team ay pwedeng mag-click ng "Estimate" button para makakuha ng AI-powered should-cost estimate.

**Inputs:** yarn type, knit type, machine type, construction, product category, factory name, actual quote total, currency

**Outputs:**
- Estimated FOB cost
- Estimated landed cost
- Confidence level (low/medium/high)
- Breakdown: materials, labor, overhead, profit
- Benchmark source at sample size
- Variance from actual quote
- Recommendation text

**Kasalukuyang behavior:**
- Optional lang — hindi required bago mag-complete ang validation
- Based sa historical data lang (walang external market prices)
- Ang LLM (Qwen3) ang nagge-generate ng estimate — kung hindi configured, error message lang
- Walang threshold na nagri-trigger ng required action kapag malayo ang estimate sa actual quote

### Questions

- **Q5.1** Required ba na i-run ang should-cost estimate bago mag-complete ang validation? O optional lang ito?
- **Q5.2** Kapag malayo ang should-cost estimate sa actual quote (e.g., > 20% variance), may required action ba para sa Costing? Dapat ba itong mag-trigger ng clarification sa factory?
- **Q5.3** Ginagamit ba ng PBD ang should-cost estimate sa approval decision? May threshold ba kung saan kailangang i-explain ng PBD kung bakit niya na-approve kahit malayo sa should-cost?
- **Q5.4** Ang should-cost engine — based sa historical data lang ba, o may external benchmark sources din (e.g., market prices for cotton, polyester)?

---

## 6. Manager Approval Threshold — Paano ito triggered?

### Context
Kapag i-click ng PBD ang "Approve", ang system ay nagche-check kung ang total cost ay lumampas sa `manager_approval_threshold` mula sa `workflow_settings` table.

**Flow:**
```
PBD clicks Approve
  → System checks: totalCost > manager_approval_threshold?
    → YES: status → pending_manager_approval (routed to manager)
      → Manager clicks Approve → status → approved (saves historical costing)
      → Manager clicks Reject → status → rejected
    → NO: status → approved (saves historical costing, auto-advances customer status)
```

**Kasalukuyang behavior:**
- Ang `manager_approval_threshold` sa `workflow_settings` ay **zero/default** — meaning lahat ng approvals ay direct, walang manager approval na nangyayari
- Ang total cost na ginagamit: `landedCost > 0 ? landedCost : grandTotal` (prefers landed cost kung available, falls back to FOB)
- Ang "manager" role ay PBD or Admin ulit (`canRunPbdAction`) — walang separate manager role
- Walang currency conversion — kung USD 50 ang threshold at ang quote ay EUR 45, hindi triggered

### Questions

- **Q6.1** Ano ang actual threshold value para sa manager approval? Wala pang setting sa database — zero/default ang value, meaning lahat ng approvals ay direct (no manager approval needed). Ano ang dapat na threshold?
- **Q6.2** Sino ang "manager" role na pwedeng mag-approve/reject sa `pending_manager_approval` status? Sa current code, `canRunPbdAction` lang ang nagche-check — meaning PBD or Admin ulit. Dapat ba may separate "manager" role, o same PBD lang?
- **Q6.3** Ang threshold — based sa FOB grand total ba, o landed cost? Sa current code, `landedCost > 0 ? landedCost : grandTotal` ang ginagamit. Tama ba ito?
- **Q6.4** Per-currency ba ang threshold, o USD-converted? Halimbawa, kung USD 50 ang threshold at ang quote ay EUR 45 (~USD 49), hindi triggered — tama ba ito?

---

## 7. Cost-Sheet Ready Toggle — Ano ang purpose nito?

### Context
Ang Cost-Sheet Ready Toggle ay isang button na available lang kapag `approved` na ang status ng request. Ito ay pwedeng i-toggle ng Costing Team o Admin (`canRunCostingAction`).

**Fields saved:**
- `cost_sheet_ready` (boolean)
- `cost_sheet_ready_at` (timestamp)
- `cost_sheet_ready_by` (role name)

**Kasalukuyang behavior:**
- Visible lang kapag `approved` na ang status
- Walang downstream effect — walang notification, walang status change, walang trigger sa ibang team
- PBD cannot toggle it (only Costing Team or Admin)

### Questions

- **Q7.1** Ano ang exact meaning ng "cost-sheet-ready"? Ito ba ay flag na ready na ang cost sheet para i-send sa customer, o ready na para sa production?
- **Q7.2** Sino ang dapat makapag-toggle nito — Costing Team lang ba, o PBD din?
- **Q7.3** May downstream effect ba ito? Halimbawa, kapag na-toggle, nag-trigger ba ng notification sa finance/production team?
- **Q7.4** Bakit ito ay visible lang kapag `approved` na ang status? Dapat ba itong available din during `for_pbd_review` para ma-flag ng Costing bago pa approve ang PBD?

---

## 8. Compliance Checks — Sino ang nag-i-input at kailan?

### Context
Ang Compliance Panel ay available sa request detail page (Analysis tab). Ang Costing Team o Admin (`canRunCostingAction`) ay pwedeng mag-add ng compliance checks.

**Available check types:**
| Code | Label |
|------|-------|
| rsl | RSL (Restricted Substances List) |
| dpp | DPP (Digital Product Passport) |
| reach | REACH Compliance |
| oeko_tex | OEKO-TEX Standard 100 |
| gots | GOTS (Global Organic Textile) |
| carbon | Carbon Footprint Assessment |

**Statuses per check:** pending, passed, failed, not_required

**Kasalukuyang behavior:**
- Hindi required — pwedeng mag-complete ang Costing validation kahit walang compliance check
- Walang mandatory checks per product category
- Kapag "failed" ang isang check, hindi ito automatically nag-block ng approval (walang error-level validation issue na nagge-generate)
- Walang separate compliance/QA role — Costing Team lang ang nag-i-input

### Questions

- **Q8.1** Required ba na may compliance check bago mag-complete ang Costing validation? Sa current code, hindi naka-enforce — pwedeng mag-complete kahit walang compliance check.
- **Q8.2** Sino ang actual nagco-conduct ng compliance tests — Costing Team ba, o separate QA/compliance team? Kung separate team, dapat ba may role para sa kanila?
- **Q8.3** May specific compliance checks na mandatory per product category? Halimbawa, GOTS lang para sa organic cotton, OEKO-TEX para sa lahat ng apparel?
- **Q8.4** Kapag "failed" ang isang compliance check, dapat ba itong automatic na i-block ang approval (error-level validation issue)?

---

## 9. Style Comparisons — Paano ito ginagamit?

### Context
Ang Like Styles Panel at Vendor Comparison Panel ay available sa request detail page (Analysis tab). Ang PBD at Costing Team (`canReviewCbd`) ay pwedeng mag-record ng style comparisons.

**Comparison types:** like_style, historical, vendor_quote
**Decisions:** reviewed, acceptable, variance_noted, rejected_comparison

**Kasalukuyang behavior:**
- Hindi required — pwedeng mag-complete ang validation kahit walang comparison
- Manual input lang ng costing team/PBD — walang auto-populate from historical costings
- Walang threshold na nagri-trigger ng required comparison

### Questions

- **Q9.1** Required ba na may at least 1 style comparison bago mag-complete ang validation? O optional lang?
- **Q9.2** Ang "like style" comparison — saan nanggagaling ang comparison data? Manual input ba ng costing team, o auto-populated from historical costings?
- **Q9.3** May threshold ba kung saan kailangan ng comparison? Halimbawa, kapag walang historical data para sa style, required ba na maghanap ng like-style comparison?

---

## 10. CBD Edit After Submission — Pwede ba itong i-edit ng Costing o PBD?

### Context
Kapag nag-submit ang factory ng CBD, ang status ay nagiging `for_costing_review`. Mula dito:
- **Factory** — hindi pwedeng mag-edit (unless status goes back to `needs_clarification`)
- **Costing Team** — read-only ang CBD, hindi pwedeng mag-edit ng unit costs, labor, overhead, etc.
- **PBD** — read-only din ang CBD

Ang tanging paraan para mag-edit ang CBD ay through "Clarify" action na nagde-derive sa `needs_clarification` status, at magre-re-submit ang factory.

May CBD Diff feature sa `/requests/[id]/cbd-diff` na nagpapakita ng comparison between CBD versions.

**Kasalukuyang behavior:** Ang clarification ay free-text comment lang — walang structured form na nag-i-indicate kung aling specific fields ang dapat i-fix ng factory.

### Questions

- **Q10.1** May scenario ba kung saan kailangan ng Costing o PBD na mag-edit ng CBD data (e.g., wrong currency, mali ang unit cost)? Kung oo, dapat ba may "request correction" feature sa halip na full clarify cycle?
- **Q10.2** Kapag nag-clarify ang Costing, ano ang exact fields na dapat i-fix ng factory? May structured form ba para sa clarification (specific fields), o free-text comment lang?
- **Q10.3** Kapag nag-re-submit ang factory after clarification, nag-keep ba ang previous CBD data para sa comparison/diff? May CBD diff feature sa `/requests/[id]/cbd-diff` — sino ang gumagamit nito at kailan?

---

## 11. Currency Conversion — Paano ito handled?

### Context
Ang CBD ay may currency field (default USD). Ang historical benchmark matching ay nagfi-filter ng same currency lang — kung ang CBD ay EUR at ang historical data ay USD, hindi sila naco-compare.

May `currency_rates` table at admin API (`/api/admin/currency-rates`) para sa pag-manage ng exchange rates. May `fetch-live` endpoint para sa auto-fetch ng rates.

**Kasalukuyang behavior:**
- Walang auto-conversion bago mag-benchmark compare — magkakaibang currency ay naka-filter out
- Ang should-cost estimate ay gumagamit ng same currency lang din
- Ang currency rates ay admin-managed (manual input o live fetch)

### Questions

- **Q11.1** Kapag ang CBD ay sa EUR at ang historical data ay sa USD, hindi sila naco-compare sa current code (filtered out). Dapat ba ang system ay mag-convert sa common currency (USD) bago mag-compare?
- **Q11.2** Sino ang nag-u-update ng currency rates? May automated fetch ba, o manual input ng admin?
- **Q11.3** Ang should-cost estimate — gumagamit ba ng currency conversion kung ang factory quote ay sa different currency?

---

## 12. Notifications at SLA — Paano ito triggered?

### Context
May notifications system (`/api/notifications/pending`, `/api/notifications/process`, `/api/notifications/escalate`) at SLA tracking.

Ang Aging Analysis sa dashboard ay nagpapakita ng:
- Fresh (0-2 days) — within SLA
- Aging (3-5 days) — approaching SLA
- Overdue — SLA breach
- Average days in status

May SLA Alerts panel na nagpapakita ng overdue requests na may days in status at SLA limit.

**Kasalukuyanging behavior:**
- Ang SLA thresholds ay nasa `sla_thresholds` table (kasalukuyang walang data — lahat ng tables ay nalimusan na)
- Ang notifications system ay admin-triggered lang (`/api/notifications/escalate`) — walang auto-escalation
- Walang specific SLA per status ang naka-configure

### Questions

- **Q12.1** Ano ang SLA per status? Halimbawa, ilang araw dapat ang factory mag-submit ng CBD after `sent_to_factory`? Ilang araw dapat ang costing review?
- **Q12.2** Kapag overdue, sino ang nakakatanggap ng notification? Factory, PBD, Costing, o lahat?
- **Q12.3** May auto-escalation ba kapag overdue na? Halimbawa, kapag 5 days na sa `for_costing_review`, auto-escalate sa admin?
- **Q12.4** Saan nanggagaling ang SLA threshold values — admin-configurable ba, o hardcoded?

---

## Summary — Most Critical Questions

Kung priority ang mga tanong, ito ang pinaka-critical na kailangan ng sagot bago ma-finalize ang costing flow:

| Priority | Question | Impact |
|:--------:|----------|--------|
| 🔴 P0 | **Q1.2** Required ba ang lahat ng checklist items bago mag-complete? | Kasalukuyang pwedeng mag-complete ng walang laman ang checklist — posibleng maging quality issue |
| 🔴 P0 | **Q6.1** Ano ang manager approval threshold? | Kasalukuyang zero — walang manager approval na nangyayari kailanman |
| 🔴 P0 | **Q6.2** Sino ang manager role? | Kasalukuyang PBD ulit — walang segregation sa manager level |
| 🟠 P1 | **Q8.1** Required ba ang compliance checks? | Kasalukuyang hindi — pwedeng mag-approve kahit walang RSL/REACH check |
| 🟠 P1 | **Q10.1** Pwede bang mag-edit ng CBD si Costing/PBD? | Kasalukuyang read-only — kailangan ng buong clarify cycle para sa maliliit na correction |
| 🟠 P1 | **Q11.1** Dapat ba mag-convert ng currency bago mag-benchmark? | Kasalukuyang naka-filter out ang magkakaibang currency — walang comparison na nangyayari |
| 🟡 P2 | **Q3.1** Tama ba ang error vs warning classification? | Kasalukuyang "missing labor cost" ay warning lang — posibleng dapat error |
| 🟡 P2 | **Q4.1** Tama ba ang 15% variance threshold? | Hardcoded — walang admin setting |
| 🟡 P2 | **Q12.1** Ano ang SLA thresholds per status? | Kasalukuyang walang SLA data — lahat ng aging calculations ay walang basis |

---

## Paano mag-reply

Markahan ang bawat tanong:
- ✅ **Confirmed** — tama ang kasalukuyang behavior, walang change needed
- ❌ **Change needed** — may dapat baguhin, ispecify ang correct behavior
- ➕ **Add new** — may additional feature/step na dapat idagdag
- ❓ **Need to discuss** — kailangan ng further discussion

Pagkatapos, i-update ang implementation base sa mga sagot.

---

## Answers (from Costing Team — 2026-08-07)

### Q1.1 — Checklist items needed
❌ **Change needed** — Only 4 items required for FTY CBD validation:
1. **MOQ** checked
2. **Lead time** checked
3. **Packaging cost** (in FTY CBD) checked
4. **Comparable style reviewed**

Ang kasalukuyang 7 default items (MOQ, lead time, packaging, nominated supplier, material buffer, comparable style, testing cost) ay dapat bawasan sa 4 lang na ito.

### Q1.2 — Required checklist before Complete Validation
✅ **Confirmed (Yes)** — Required na lahat ng 4 checklist items ay checked bago mag-complete validation.

### Q3.1 — Error vs Warning classification
➕ **Add new** — Complete operations, knitting machine, and yarn dapat based on the sample's construction. Pero ang **responsible for checking is MD** (Merchandising), hindi Costing Team. Ang MD ay **ibang role** — kailangan ng separate role para sa MD sa system.

### Q6.2 — Manager/Approver role
❌ **Change needed** — **Aci and Lovely** ang mag-aapprove ng reviewed FTY CBDs. Sila ang "manager" role para sa approval. Hindi PBD ulit ang approver.

### Q10.1 — CBD Edit by Costing/PBD
❌ **Change needed** — Hindi pwedeng mag-edit ng CBD si Costing o PBD. Pwede lang itong maging **pending correction or revision ng FTY**. Mas ok kung **si FTY lang ang may access to edit**, for clear audit/history.

### Q11.1 — Currency
✅ **Confirmed** — Palaging **$ (USD) currency** ang gamit ni FTY sa pag-create ng FTY CBD. Walang currency conversion issue.

### Q12.1 — SLA per status
❌ **Change needed** — Ang SLA flow ay:
1. **Upon sample dispatch** → FTY has **36 hrs** to submit FTY CBD
2. **Upon FTY CBD receipt** → Costing Team has **24 hrs** to validate and enter costs sa NG (NextGen)
3. **Upon entering costs sa NG** → Notify PBD na may costing line na sa NG
4. **Upon receiving NG costing notification** → PBD has **24 hrs** to put Selling Price sa NG

### New Role: MD (Merchandising)
➕ **Add new** — MD is a **separate role**. Responsible for checking complete operations, knitting machine, and yarn (based on sample's construction). Kailangan idagdag ang MD role sa system roles.
