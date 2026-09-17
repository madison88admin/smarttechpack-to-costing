"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { IconCheck, IconArrowLeft, IconArrowRight, IconPlus, IconTrash, IconAlert } from "@/components/ui/icons";
import { FactoryPhotoUpload } from "@/components/factory-photo-upload";
import { Tooltip } from "@/components/ui/tooltip";

type BomLine = {
  id: string;
  material_name: string | null;
  category: string | null;
  consumption: number | null;
  uom: string | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";
type ExistingCbd = {
  raw_payload: unknown;
  cbd_material_lines: {
    bom_line_id: string | null;
    material_name: string | null;
    unit_cost: number | null;
    currency: string | null;
  }[];
} | null;

const STEPS = ["Header Info", "Yarn", "Fabric & Trim", "Knitting & Operations", "Packaging & Overhead", "Notes", "Submit"] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Reference data from Excel template (FTY CBD - template.xlsx)
// Column A: Knitting types
const KNITTING_REFERENCE = [
  "Scripto",
  "Circular (AZE/ Jacquard)",
  "Flat-12GG",
  "Automatic Glove",
  "Jacquard Glove",
  "Finger Linking",
  "Flat-10GG",
  "Flat-7GG",
  "Flat-9GG",
  "Flat-5GG",
  "Flat-3GG",
  "Hand Knit",
];

// Column B: Operations
const OPERATIONS_REFERENCE = [
  "Cutting",
  "Linking",
  "Sewing",
  "Blind Sewing",
  "Sewing Lining",
  "Hand sewing",
  "Labeling",
  "Neaten/Steaming/Packing",
  "Embroidery",
  "Printing",
  "Washing",
  "Pompom, Braid, Tassle making",
  "Overlock",
];

// Column C: Packaging materials
const PACKAGING_REFERENCE = [
  "Carton Box",
  "Cardboard insert",
  "J-Hook",
  "Plastic Pin",
  "Polybag",
  "Seal Tape",
];

// Column D: Packaging categories
const PACKAGING_CATEGORIES = ["Standard Packaging", "Special Packaging"];

type YarnLine = {
  name: string;
  consumption: string;
  // Material price computation breakdown
  fobPrice: string;        // FOB USD/kg
  surchargePercent: string; // e.g. 20 for 20%
  freightCost: string;     // USD/kg (e.g. 0.36)
  markupPercent: string;   // e.g. 15 for 15%
  materialPrice: string;   // auto-computed: ((FOB × (1+surcharge%)) + freight) × (1+markup%)
  materialCost: string;    // auto-computed: consumption(g)/1000 × materialPrice
  showCalc: boolean;       // toggle calc breakdown
};
type FabricLine = { name: string; consumption: string; materialPrice: string; materialCost: string };
type TrimLine = { name: string; consumption: string; materialPrice: string; materialCost: string };
type KnittingLine = { machineType: string; knittingTime: string; sah: string; knittingCost: string };
type OperationLine = { operation: string; operationCost: string };
type RevisionChange = {
  field: string;
  fieldKey: string;
  section: string;
  oldValue: string;
  newValue: string;
  /** Set for reviewer-requested targets (open change requests) as opposed to
      already-applied revision diffs. Requested rows render as targets. */
  requested?: boolean;
};

// Default lines from Excel template (pre-filled in blank template)
const DEFAULT_YARN_LINES: YarnLine[] = [
  { name: "100%ACRYLIC", consumption: "", fobPrice: "", surchargePercent: "", freightCost: "", markupPercent: "", materialPrice: "", materialCost: "", showCalc: false },
  { name: "e-tip yarn", consumption: "", fobPrice: "", surchargePercent: "", freightCost: "", markupPercent: "", materialPrice: "", materialCost: "", showCalc: false },
  { name: "elastic (local)", consumption: "", fobPrice: "", surchargePercent: "", freightCost: "", markupPercent: "", materialPrice: "", materialCost: "", showCalc: false },
  { name: "nylon (local)", consumption: "", fobPrice: "", surchargePercent: "", freightCost: "", markupPercent: "", materialPrice: "", materialCost: "", showCalc: false },
];
const DEFAULT_FABRIC_LINES: FabricLine[] = [
  { name: "leather", consumption: "", materialPrice: "", materialCost: "" },
];
const DEFAULT_TRIM_LINES: TrimLine[] = [
  { name: "Sewing Thread (local sourced thread)", consumption: "", materialPrice: "", materialCost: "" },
];

export function FactoryCbdForm({
  requestId,
  bomLines,
  existingCbd,
  readOnly = false,
  prefill,
  baselineRef = null,
  initialStep = 0,
  revisionChange = null,
  revisionChanges = []
}: {
  requestId: string;
  bomLines: BomLine[];
  existingCbd?: ExistingCbd;
  readOnly?: boolean;
  prefill?: {
    customer?: string;
    season?: string;
    styleNumber?: string;
    styleName?: string;
  };
  /** Read-only reference to the approved costing this request was copied from. */
  baselineRef?: import("@/lib/costing/history").BaselineRef | null;
  /** Deep links from validation findings open the exact CBD step. */
  initialStep?: StepIndex;
  /** A comparison deep link identifies the precise field changed in a prior CBD revision. */
  revisionChange?: {
    field: string;
    fieldKey: string;
    section: string;
    oldValue: string;
    newValue: string;
    requested?: boolean;
  } | null;
  /** All changed inputs in the CBD version being viewed. */
  revisionChanges?: RevisionChange[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const header = getHeaderDefaults(existingCbd?.raw_payload);
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [currentStep, setCurrentStep] = useState<StepIndex>(initialStep);

  // Deep links (?step=N from validation findings, diff pages, and requested
  // changes) must actually jump: useState only reads initialStep on mount, so
  // sync when the parent navigates to a new step. Manual Back/Next clicks use
  // goToStep directly and never change the prop, so this cannot fight typing.
  useEffect(() => {
    setCurrentStep(initialStep);
  }, [initialStep]);

  // Initialize line items from existing CBD or template defaults
  const existing = getExistingLines(existingCbd?.raw_payload);
  const hasExisting = !!existingCbd?.raw_payload;
  const [yarnLines, setYarnLines] = useState<YarnLine[]>(existing.yarn.length > 0 || hasExisting ? existing.yarn : DEFAULT_YARN_LINES);
  const [fabricLines, setFabricLines] = useState<FabricLine[]>(existing.fabric.length > 0 || hasExisting ? existing.fabric : DEFAULT_FABRIC_LINES);
  const [trimLines, setTrimLines] = useState<TrimLine[]>(existing.trim.length > 0 || hasExisting ? existing.trim : DEFAULT_TRIM_LINES);
  const [knittingLines, setKnittingLines] = useState<KnittingLine[]>(existing.knitting);
  const [operationLines, setOperationLines] = useState<OperationLine[]>(existing.operations);
  const [operationsNotes, setOperationsNotes] = useState(existing.operationsNotes ?? "");
  const [packagingNotes, setPackagingNotes] = useState(existing.packagingNotes ?? "");
  const [overheadNotes, setOverheadNotes] = useState(existing.overheadNotes ?? "");
  const [costFields, setCostFields] = useState({
    standardPackagingCost: header.standardPackagingCost ?? "",
    specialPackagingCost: header.specialPackagingCost ?? "",
    overheadCost: header.overheadCost ?? "",
    profitCost: header.profitCost ?? ""
  });
  const [reviewHeader, setReviewHeader] = useState({
    customer: header.customer ?? prefill?.customer ?? "",
    season: header.season ?? "",
    styleNumber: header.styleNumber ?? prefill?.styleNumber ?? "",
    styleName: header.styleName ?? prefill?.styleName ?? "",
    leadTimeDays: header.leadTimeDays ?? ""
  });
  const allRevisionChanges = revisionChanges.length > 0 ? revisionChanges : revisionChange ? [revisionChange] : [];
  const changeForField = (fieldKey: string) => allRevisionChanges.find((change) => change.fieldKey === fieldKey) ?? null;
  const isChangedField = (fieldKey: string) => Boolean(changeForField(fieldKey));
  const revisionFieldClass = (fieldKey: string, base = "input") => `${base}${isChangedField(fieldKey) ? " cbd-revision-field" : ""}`;
  const revisionFieldHint = (fieldKey: string) => {
    const change = changeForField(fieldKey);
    if (!change) return null;
    return (
      <p className="cbd-revision-field-hint" role="status">
        <IconAlert size={13} /> {change.requested ? "Requested" : "Changed"}: <s>{change.oldValue}</s> → <strong>{change.newValue}</strong>
      </p>
    );
  };

  // Computed totals
  const yarnTotal = yarnLines.reduce((sum, l) => sum + (parseFloat(l.materialCost) || 0), 0);
  const fabricTotal = fabricLines.reduce((sum, l) => sum + (parseFloat(l.materialCost) || 0), 0);
  const trimTotal = trimLines.reduce((sum, l) => sum + (parseFloat(l.materialCost) || 0), 0);
  const materialTotal = yarnTotal + fabricTotal + trimTotal;
  const knittingTotal = knittingLines.reduce((sum, l) => sum + (parseFloat(l.knittingCost) || 0), 0);
  const operationsTotal = operationLines.reduce((sum, l) => sum + (parseFloat(l.operationCost) || 0), 0);
  const factoryCostEstimate =
    materialTotal +
    knittingTotal +
    operationsTotal +
    (parseFloat(costFields.standardPackagingCost) || 0) +
    (parseFloat(costFields.specialPackagingCost) || 0) +
    (parseFloat(costFields.overheadCost) || 0) +
    (parseFloat(costFields.profitCost) || 0);

  function addYarnLine() {
    setYarnLines([...yarnLines, { name: "", consumption: "", fobPrice: "", surchargePercent: "", freightCost: "", markupPercent: "", materialPrice: "", materialCost: "", showCalc: false }]);
  }
  function removeYarnLine(i: number) {
    setYarnLines(yarnLines.filter((_, idx) => idx !== i));
  }

  // Compute material price from breakdown: ((FOB × (1+surcharge%)) + freight) × (1+markup%)
  function computeMaterialPrice(line: YarnLine): string {
    const fob = parseFloat(line.fobPrice) || 0;
    const surcharge = (parseFloat(line.surchargePercent) || 0) / 100;
    const freight = parseFloat(line.freightCost) || 0;
    const markup = (parseFloat(line.markupPercent) || 0) / 100;
    const price = ((fob * (1 + surcharge)) + freight) * (1 + markup);
    return price > 0 ? price.toFixed(4) : "";
  }

  // Compute material cost = consumption(g) / 1000 × materialPrice(USD/kg)
  function computeMaterialCost(consumption: string, materialPrice: string): string {
    const c = parseFloat(consumption) || 0;
    const p = parseFloat(materialPrice) || 0;
    const cost = (c / 1000) * p;
    return cost > 0 ? cost.toFixed(5) : "";
  }

  function updateYarnLine(i: number, field: keyof YarnLine, value: string | boolean) {
    const updated = [...yarnLines];
    updated[i] = { ...updated[i], [field]: value };

    // Recompute material price if any calc field changed
    const calcFields: (keyof YarnLine)[] = ["fobPrice", "surchargePercent", "freightCost", "markupPercent"];
    if (calcFields.includes(field)) {
      updated[i].materialPrice = computeMaterialPrice(updated[i]);
    }

    // Recompute material cost if consumption or material price changed
    if (field === "consumption" || field === "materialPrice" || calcFields.includes(field)) {
      updated[i].materialCost = computeMaterialCost(
        field === "consumption" ? String(value) : updated[i].consumption,
        updated[i].materialPrice
      );
    }

    setYarnLines(updated);
  }

  function addFabricLine() {
    setFabricLines([...fabricLines, { name: "", consumption: "", materialPrice: "", materialCost: "" }]);
  }
  function removeFabricLine(i: number) {
    setFabricLines(fabricLines.filter((_, idx) => idx !== i));
  }
  function updateFabricLine(i: number, field: keyof FabricLine, value: string) {
    const updated = [...fabricLines];
    updated[i] = { ...updated[i], [field]: value };
    if (field === "consumption" || field === "materialPrice") {
      const c = parseFloat(field === "consumption" ? value : updated[i].consumption) || 0;
      const p = parseFloat(field === "materialPrice" ? value : updated[i].materialPrice) || 0;
      updated[i].materialCost = (c * p).toFixed(5);
    }
    setFabricLines(updated);
  }

  function addTrimLine() {
    setTrimLines([...trimLines, { name: "", consumption: "", materialPrice: "", materialCost: "" }]);
  }
  function removeTrimLine(i: number) {
    setTrimLines(trimLines.filter((_, idx) => idx !== i));
  }
  function updateTrimLine(i: number, field: keyof TrimLine, value: string) {
    const updated = [...trimLines];
    updated[i] = { ...updated[i], [field]: value };
    if (field === "consumption" || field === "materialPrice") {
      const c = parseFloat(field === "consumption" ? value : updated[i].consumption) || 0;
      const p = parseFloat(field === "materialPrice" ? value : updated[i].materialPrice) || 0;
      updated[i].materialCost = (c * p).toFixed(5);
    }
    setTrimLines(updated);
  }

  function addKnittingLine() {
    setKnittingLines([...knittingLines, { machineType: "", knittingTime: "", sah: "", knittingCost: "" }]);
  }
  function removeKnittingLine(i: number) {
    setKnittingLines(knittingLines.filter((_, idx) => idx !== i));
  }
  function updateKnittingLine(i: number, field: keyof KnittingLine, value: string) {
    const updated = [...knittingLines];
    updated[i] = { ...updated[i], [field]: value };
    if (field === "knittingTime" || field === "sah") {
      const t = parseFloat(field === "knittingTime" ? value : updated[i].knittingTime) || 0;
      const s = parseFloat(field === "sah" ? value : updated[i].sah) || 0;
      updated[i].knittingCost = (t * s).toFixed(2);
    }
    setKnittingLines(updated);
  }

  function addOperationLine() {
    setOperationLines([...operationLines, { operation: "", operationCost: "" }]);
  }
  function removeOperationLine(i: number) {
    setOperationLines(operationLines.filter((_, idx) => idx !== i));
  }
  function updateOperationLine(i: number, field: keyof OperationLine, value: string) {
    const updated = [...operationLines];
    updated[i] = { ...updated[i], [field]: value };
    setOperationLines(updated);
  }

  async function save(status: "draft" | "submitted", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const currentForm = event?.currentTarget ?? formRef.current;
    if (!currentForm) return;

    setState("saving");
    setMessage("");

    const form = new FormData(currentForm);

    const response = await fetch(`/api/costing/requests/${requestId}/cbd`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        currency: "USD",
        // Header info
        customer: String(form.get("customer") ?? ""),
        season: String(form.get("season") ?? ""),
        styleNumber: String(form.get("styleNumber") ?? ""),
        styleName: String(form.get("styleName") ?? ""),
        costedQty: String(form.get("costedQty") ?? ""),
        leadTimeDays: String(form.get("leadTimeDays") ?? ""),
        finishWeight: String(form.get("finishWeight") ?? ""),
        protoVersion: String(form.get("protoVersion") ?? ""),
        moq: String(form.get("moq") ?? ""),
        materialBufferPercent: String(form.get("materialBufferPercent") ?? ""),
        testingCost: String(form.get("testingCost") ?? ""),
        brandNominatedItems: String(form.get("brandNominatedItems") ?? ""),
        m88Packaging: String(form.get("m88Packaging") ?? ""),
        yarnType: String(form.get("yarnType") ?? ""),
        knitType: String(form.get("knitType") ?? ""),
        machineType: String(form.get("machineType") ?? ""),
        construction: String(form.get("construction") ?? ""),
        productCategory: String(form.get("productCategory") ?? ""),
        // Structured line items
        yarnLines: yarnLines.filter(l => l.name || l.consumption).map(l => ({
          name: l.name,
          consumption: l.consumption,
          fobPrice: l.fobPrice,
          surchargePercent: l.surchargePercent,
          freightCost: l.freightCost,
          markupPercent: l.markupPercent,
          materialPrice: l.materialPrice,
          materialCost: l.materialCost
        })),
        fabricLines: fabricLines.filter(l => l.name || l.consumption),
        trimLines: trimLines.filter(l => l.name || l.consumption),
        knittingLines: knittingLines.filter(l => l.machineType || l.knittingTime),
        operationsLines: operationLines.filter(l => l.operation),
        // Packaging
        standardPackagingCost: String(form.get("standardPackagingCost") ?? ""),
        specialPackagingCost: String(form.get("specialPackagingCost") ?? ""),
        // Overhead/Profit
        overheadCost: String(form.get("overheadCost") ?? ""),
        profitCost: String(form.get("profitCost") ?? ""),
        // Notes
        yarnNotes: String(form.get("yarnNotes") ?? ""),
        operationsNotes,
        packagingNotes,
        overheadNotes,
        notes: String(form.get("notes") ?? ""),
        costingLearning: String(form.get("costingLearning") ?? ""),
        recurringIssueTags: String(form.get("recurringIssueTags") ?? ""),
        // Legacy BOM lines (keep for backward compat)
        lines: []
      })
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      setState("error");
      const errMsg = result.error ?? "Unable to save CBD";
      setMessage(errMsg);
      toast.add({ type: "error", description: errMsg, priority: "high" });
      return;
    }

    setState("saved");
    const issueCount = Array.isArray(result.data.validationIssues) ? result.data.validationIssues.length : 0;
    const msg =
      status === "submitted"
        ? issueCount
          ? `CBD submitted with ${issueCount} validation issue(s)`
          : "CBD submitted successfully"
        : "CBD draft saved";
    setMessage(msg);
    toast.add({
      type: status === "submitted" && issueCount > 0 ? "warning" : "success",
      description: msg
    });
    router.refresh();
  }

  function refreshReviewHeader() {
    if (!formRef.current) return;
    const form = new FormData(formRef.current);
    setReviewHeader({
      customer: String(form.get("customer") ?? ""),
      season: String(form.get("season") ?? ""),
      styleNumber: String(form.get("styleNumber") ?? ""),
      styleName: String(form.get("styleName") ?? ""),
      leadTimeDays: String(form.get("leadTimeDays") ?? "")
    });
  }

  function goToStep(step: StepIndex) {
    if (step === 6) refreshReviewHeader();
    setCurrentStep(step);
  }
  function nextStep() {
    const next = Math.min(6, currentStep + 1) as StepIndex;
    if (next === 6) refreshReviewHeader();
    setCurrentStep(next);
  }
  function prevStep() { setCurrentStep((prev) => Math.max(0, prev - 1) as StepIndex); }

  return (
    <form ref={formRef} className="panel" onSubmit={(event) => save("draft", event)}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Factory Workspace</p>
          <h2>{readOnly ? "CBD Review (Read-Only)" : "Factory Cost Breakdown"}</h2>
        </div>
        <span className="status blue">Step {currentStep + 1} of {STEPS.length}</span>
      </div>
      {readOnly ? (
        <p className="notice" style={{ marginBottom: 12 }}>
          This CBD is view-only. The request is no longer in an editable status.
        </p>
      ) : null}

      {allRevisionChanges.length > 0 ? (
        <div className="notice" style={{ marginBottom: 12, borderColor: "rgba(245, 158, 11, 0.55)", background: "rgba(245, 158, 11, 0.08)" }}>
          <strong><IconAlert size={15} /> {allRevisionChanges.every((change) => change.requested) ? `Requested changes (${allRevisionChanges.length})` : `Changes in this CBD revision (${allRevisionChanges.length})`}</strong>
          <p className="eyebrow" style={{ margin: "6px 0 8px" }}>{allRevisionChanges.every((change) => change.requested) ? "The reviewer asked for these exact values. Update each highlighted input, then resubmit." : "Changed sections and inputs are highlighted below. Compare every value before continuing."}</p>
          <ul className="cbd-revision-summary-list">
            {allRevisionChanges.map((change) => (
              <li key={change.fieldKey}>
                <strong>{change.section} · {change.field}:</strong> <s>{change.oldValue}</s> → <strong>{change.newValue}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {baselineRef ? (
        <div className="baseline-banner" style={{ marginBottom: 16 }}>
          <div>
            <strong>Approved baseline reference: {baselineRef.styleNumber ?? "historical style"}</strong>
            <p className="eyebrow">
              {[
                baselineRef.totalCost != null ? `${baselineRef.currency ?? "USD"} ${baselineRef.totalCost.toFixed(2)}` : null,
                baselineRef.factoryName,
                baselineRef.yarnType ? `Yarn: ${baselineRef.yarnType}` : null,
                baselineRef.knitType ? `Knit: ${baselineRef.knitType}` : null,
                baselineRef.machineType ? `Machine: ${baselineRef.machineType}` : null,
                baselineRef.averageConsumption != null ? `Cons.: ${baselineRef.averageConsumption.toFixed(2)} kg` : null,
                baselineRef.knittingTime != null ? `Knit time: ${baselineRef.knittingTime.toFixed(2)} min` : null
              ]
                .filter(Boolean)
                .join(" · ") || "Reference costing"}
            </p>
            <p className="eyebrow">Reference only — enter your actual figures below.</p>
          </div>
        </div>
      ) : null}

      <div className="step-list wizard">
        {STEPS.map((label, index) => {
          const stepState = index < currentStep ? "done" : index === currentStep ? "current" : "pending";
          const stepChanges = allRevisionChanges.filter((change) => change.section === label);
          const isRevisionStep = stepChanges.length > 0;
          const stepRequestedOnly = isRevisionStep && stepChanges.every((change) => change.requested);
          return (
            <button key={label} type="button" className={`step ${stepState}${isRevisionStep ? " step-revision-target" : ""}`} onClick={() => goToStep(index as StepIndex)} aria-label={`${label}${isRevisionStep ? `: contains ${stepChanges.length} CBD change${stepChanges.length === 1 ? "" : "s"}` : ""}`}>
              <span className="step-number">{index < currentStep ? <IconCheck size={14} /> : index + 1}</span>
              <span className="step-label">{label}</span>{isRevisionStep ? <span className="step-revision-badge">{stepChanges.length} {stepRequestedOnly ? "requested" : "changed"}</span> : null}
            </button>
          );
        })}
      </div>

      {/* Step 1: Header Info */}
      <div className="form-section-card" style={{ display: currentStep === 0 ? "block" : "none" }}>
        <h3>Header Information</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="customer">Customer</label>
            <input id="customer" name="customer" className="input" placeholder="e.g. VANS" defaultValue={header.customer ?? prefill?.customer ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="season">Season</label>
            <input id="season" name="season" className="input" placeholder="e.g. F27" defaultValue={header.season ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="styleNumber">Style #</label>
            <input id="styleNumber" name="styleNumber" className="input" placeholder="e.g. VN0013RS" defaultValue={header.styleNumber ?? prefill?.styleNumber ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="styleName">Style Name</label>
            <input id="styleName" name="styleName" className="input" placeholder="e.g. New Wide Cuff Beanie" defaultValue={header.styleName ?? prefill?.styleName ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="costedQty">Costed Qty</label>
            <input id="costedQty" name="costedQty" className="input" placeholder="e.g. 2800 pcs / 600 pcs" defaultValue={header.costedQty ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="leadTimeDays">Lead Time (days)</label>
            <input id="leadTimeDays" name="leadTimeDays" className="input" placeholder="e.g. 130" defaultValue={header.leadTimeDays ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="finishWeight">Finish Weight</label>
            <input id="finishWeight" name="finishWeight" className="input" placeholder="e.g. 98gr" defaultValue={header.finishWeight ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="protoVersion">Proto Version</label>
            <input id="protoVersion" name="protoVersion" className="input" placeholder="e.g. P1, P2, P2 REMAKE" defaultValue={header.protoVersion ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="moq">MOQ (pcs)</label>
            <input id="moq" name="moq" className="input" type="number" min="0" placeholder="e.g. 1000" defaultValue={header.moq ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="materialBufferPercent">Material Buffer (%)</label>
            <input id="materialBufferPercent" name="materialBufferPercent" className="input" type="number" min="0" step="0.01" placeholder="e.g. 15" defaultValue={header.materialBufferPercent ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="testingCost">Testing Cost (USD/pc)</label>
            <input id="testingCost" name="testingCost" className="input" type="number" min="0" step="0.0001" placeholder="e.g. 0.05" defaultValue={header.testingCost ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="productCategory">Product Category</label>
            <input id="productCategory" name="productCategory" className="input" placeholder="e.g. Accessories" defaultValue={header.productCategory ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="yarnType">Yarn Type</label>
            <input id="yarnType" name="yarnType" className="input" placeholder="e.g. Wool blend" defaultValue={header.yarnType ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="knitType">Knit Type</label>
            <input id="knitType" name="knitType" className="input" placeholder="e.g. Flat knit" defaultValue={header.knitType ?? ""} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="machineType">Machine Type</label>
            <input id="machineType" name="machineType" className={revisionFieldClass("machineType")} placeholder="e.g. Flat-12GG" defaultValue={header.machineType ?? ""} disabled={readOnly} />
            {revisionFieldHint("machineType")}
          </div>
          <div className="field">
            <label htmlFor="construction">Construction</label>
            <input id="construction" name="construction" className="input" placeholder="e.g. 1x1 rib" defaultValue={header.construction ?? ""} disabled={readOnly} />
          </div>
        </div>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="field full">
            <label htmlFor="brandNominatedItems">Brand-nominated items / suppliers</label>
            <textarea id="brandNominatedItems" name="brandNominatedItems" className="input textarea" placeholder="List nominated yarns, trims, or suppliers" defaultValue={header.brandNominatedItems ?? ""} disabled={readOnly} />
          </div>
          <div className="field full">
            <label htmlFor="m88Packaging">M88 packaging requirements</label>
            <textarea id="m88Packaging" name="m88Packaging" className="input textarea" placeholder="Packaging requirements from MML / M88" defaultValue={header.m88Packaging ?? ""} disabled={readOnly} />
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <FactoryPhotoUpload requestId={requestId} readOnly={readOnly} />
        </div>

        <div className="wizard-nav">
          <span />
          <button type="button" className="button" onClick={nextStep}>Next: Yarn <IconArrowRight size={14} /></button>
        </div>
      </div>

      {/* Step 2: Yarn */}
      <div className="form-section-card" style={{ display: currentStep === 1 ? "block" : "none" }}>
        <h3>Yarn</h3>
        <table className="table compact">
          <thead>
            <tr>
              <th>Yarn Name</th>
              <th style={{ width: 100 }}>Consumption (g)</th>
              <th style={{ width: 120 }}>Material Price (USD/kg)</th>
              <th style={{ width: 110 }}>Material Cost</th>
              <th style={{ width: 70 }}></th>
            </tr>
          </thead>
          <tbody>
            {yarnLines.map((line, i) => (
              <Fragment key={`yarn-line-${i}`}>
                <tr key={`row-${i}`}>
                  <td>
                    <input className="input table-input" placeholder="Yarn name & specs" value={line.name} onChange={(e) => updateYarnLine(i, "name", e.target.value)} disabled={readOnly} />
                  </td>
                  <td>
                    <input className="input table-input" type="number" step="any" placeholder="0" value={line.consumption} onChange={(e) => updateYarnLine(i, "consumption", e.target.value)} disabled={readOnly} />
                  </td>
                  <td>
                    <input className="input table-input" type="number" step="any" placeholder="0.00" value={line.materialPrice} onChange={(e) => updateYarnLine(i, "materialPrice", e.target.value)} disabled={readOnly} />
                    {!readOnly && (
                      <button type="button" className="button tertiary tiny" style={{ marginTop: 4, padding: "2px 8px", fontSize: 11 }} onClick={() => updateYarnLine(i, "showCalc", !line.showCalc)}>
                        {line.showCalc ? "Hide calc" : "Calc price"}
                      </button>
                    )}
                  </td>
                  <td>
                    <strong>{line.materialCost ? parseFloat(line.materialCost).toFixed(5) : "0.00"}</strong>
                  </td>
                  <td>
                    {!readOnly && <button type="button" className="icon-button" onClick={() => removeYarnLine(i)} title="Remove"><IconTrash size={14} /></button>}
                  </td>
                </tr>
                {line.showCalc && (
                  <tr key={`calc-${i}`}>
                    <td colSpan={5} style={{ background: "var(--surface-2, #f8f9fa)", padding: "12px 16px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, alignItems: "end" }}>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 11 }}>FOB Price (USD/kg)</label>
                        <Tooltip text="Free On Board price per kg, excluding freight and insurance">
                          <input className="input table-input" type="number" step="any" placeholder="e.g. 5.05" value={line.fobPrice} onChange={(e) => updateYarnLine(i, "fobPrice", e.target.value)} disabled={readOnly} />
                        </Tooltip>
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 11 }}>Surcharge (%)</label>
                        <Tooltip text="Additional percentage added to FOB (e.g. 20% for minimum order surcharge)">
                          <input className="input table-input" type="number" step="any" placeholder="e.g. 20" value={line.surchargePercent} onChange={(e) => updateYarnLine(i, "surchargePercent", e.target.value)} disabled={readOnly} />
                        </Tooltip>
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 11 }}>Freight (USD/kg)</label>
                        <Tooltip text="Shipping and handling cost per kg from factory to destination">
                          <input className="input table-input" type="number" step="any" placeholder="e.g. 0.36" value={line.freightCost} onChange={(e) => updateYarnLine(i, "freightCost", e.target.value)} disabled={readOnly} />
                        </Tooltip>
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 11 }}>Markup (%)</label>
                        <Tooltip text="Factory margin percentage applied to material cost">
                          <input className="input table-input" type="number" step="any" placeholder="e.g. 15" value={line.markupPercent} onChange={(e) => updateYarnLine(i, "markupPercent", e.target.value)} disabled={readOnly} />
                        </Tooltip>
                      </div>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted, #666)" }}>
                        <strong>Formula:</strong> ((FOB × (1 + Surcharge%)) + Freight) × (1 + Markup%) = Material Price
                        {line.fobPrice && (
                          <span style={{ marginLeft: 12 }}>
                            = (({parseFloat(line.fobPrice).toFixed(2)} × (1 + {(parseFloat(line.surchargePercent) || 0) / 100})) + {parseFloat(line.freightCost) || 0}) × (1 + {(parseFloat(line.markupPercent) || 0) / 100})
                            {line.materialPrice && <strong> = ${parseFloat(line.materialPrice).toFixed(4)}/kg</strong>}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {yarnLines.length === 0 && (
              <tr><td colSpan={5} className="text-center text-muted">No yarn lines. Click &quot;Add Yarn&quot; to add one.</td></tr>
            )}
          </tbody>
        </table>
        {!readOnly && <button type="button" className="button secondary small" onClick={addYarnLine} style={{ marginTop: 8 }}><IconPlus size={14} /> Add Yarn</button>}
        <div style={{ marginTop: 12 }}>
          <div className="field full">
            <label htmlFor="yarnNotes">Yarn Notes (FOB, CIF, MCQ, MOQ, surcharge details)</label>
            <textarea id="yarnNotes" name="yarnNotes" className="input textarea small-textarea" placeholder="e.g. FOB USD$5.05/Kg=CIF USD$6.22/Kg&#10;MCQ 300kg = 2800 pcs&#10;MOQ 1500kg&#10;+20% Surcharge for 600pcs" defaultValue={header.yarnNotes ?? ""} disabled={readOnly}></textarea>
          </div>
        </div>
        <div className="summary-bar" style={{ marginTop: 12 }}>
          <strong>Yarn Total: USD {yarnTotal.toFixed(5)}</strong>
        </div>
        <div className="wizard-nav">
          <button type="button" className="button secondary" onClick={prevStep}><IconArrowLeft size={14} /> Back</button>
          <button type="button" className="button" onClick={nextStep}>Next: Fabric & Trim <IconArrowRight size={14} /></button>
        </div>
      </div>

      {/* Step 3: Fabric & Trim */}
      <div className="form-section-card" style={{ display: currentStep === 2 ? "block" : "none" }}>
        <h3>Fabric</h3>
        <table className="table compact">
          <thead>
            <tr>
              <th>Fabric</th>
              <th style={{ width: 120 }}>Consumption (yards)</th>
              <th style={{ width: 140 }}>Material Price (USD/yd)</th>
              <th style={{ width: 120 }}>Material Cost</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {fabricLines.map((line, i) => (
              <tr key={i}>
                <td><input className="input table-input" placeholder="Fabric name" value={line.name} onChange={(e) => updateFabricLine(i, "name", e.target.value)} disabled={readOnly} /></td>
                <td><input className="input table-input" type="number" step="any" placeholder="0" value={line.consumption} onChange={(e) => updateFabricLine(i, "consumption", e.target.value)} disabled={readOnly} /></td>
                <td><input className="input table-input" type="number" step="any" placeholder="0.00" value={line.materialPrice} onChange={(e) => updateFabricLine(i, "materialPrice", e.target.value)} disabled={readOnly} /></td>
                <td><strong>{line.materialCost ? parseFloat(line.materialCost).toFixed(5) : "0.00"}</strong></td>
                <td>{!readOnly && <button type="button" className="icon-button" onClick={() => removeFabricLine(i)}><IconTrash size={14} /></button>}</td>
              </tr>
            ))}
            {fabricLines.length === 0 && <tr><td colSpan={5} className="text-center text-muted">No fabric lines.</td></tr>}
          </tbody>
        </table>
        {!readOnly && <button type="button" className="button secondary small" onClick={addFabricLine} style={{ marginTop: 8 }}><IconPlus size={14} /> Add Fabric</button>}

        <h3 style={{ marginTop: 24 }}>Trim</h3>
        <table className="table compact">
          <thead>
            <tr>
              <th>Trim</th>
              <th style={{ width: 120 }}>Consumption (piece)</th>
              <th style={{ width: 140 }}>Material Price (USD/pc)</th>
              <th style={{ width: 120 }}>Material Cost</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {trimLines.map((line, i) => (
              <tr key={i}>
                <td><input className="input table-input" placeholder="Trim name" value={line.name} onChange={(e) => updateTrimLine(i, "name", e.target.value)} disabled={readOnly} /></td>
                <td><input className="input table-input" type="number" step="any" placeholder="0" value={line.consumption} onChange={(e) => updateTrimLine(i, "consumption", e.target.value)} disabled={readOnly} /></td>
                <td><input className="input table-input" type="number" step="any" placeholder="0.00" value={line.materialPrice} onChange={(e) => updateTrimLine(i, "materialPrice", e.target.value)} disabled={readOnly} /></td>
                <td><strong>{line.materialCost ? parseFloat(line.materialCost).toFixed(5) : "0.00"}</strong></td>
                <td>{!readOnly && <button type="button" className="icon-button" onClick={() => removeTrimLine(i)}><IconTrash size={14} /></button>}</td>
              </tr>
            ))}
            {trimLines.length === 0 && <tr><td colSpan={5} className="text-center text-muted">No trim lines.</td></tr>}
          </tbody>
        </table>
        {!readOnly && <button type="button" className="button secondary small" onClick={addTrimLine} style={{ marginTop: 8 }}><IconPlus size={14} /> Add Trim</button>}

        <div className="summary-bar" style={{ marginTop: 16 }}>
          <strong>Total Material & Submaterials: USD {materialTotal.toFixed(5)}</strong>
          <span style={{ marginLeft: 16 }}>(Yarn: {yarnTotal.toFixed(5)} + Fabric: {fabricTotal.toFixed(5)} + Trim: {trimTotal.toFixed(5)})</span>
        </div>
        <div className="wizard-nav">
          <button type="button" className="button secondary" onClick={prevStep}><IconArrowLeft size={14} /> Back</button>
          <button type="button" className="button" onClick={nextStep}>Next: Knitting & Operations <IconArrowRight size={14} /></button>
        </div>
      </div>

      {/* Step 4: Knitting & Operations */}
      <div className="form-section-card" style={{ display: currentStep === 3 ? "block" : "none" }}>
        <h3>Knitting</h3>
        <table className="table compact">
          <thead>
            <tr>
              <th>Machine Type</th>
              <th style={{ width: 130 }}>Knitting Time (mins)</th>
              <th style={{ width: 130 }}>SAH (USD/min)</th>
              <th style={{ width: 120 }}>Knitting Cost</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {knittingLines.map((line, i) => (
              <tr key={i}>
                <td>
                  <select className={revisionFieldClass(`knittingLines.${i}.machineType`, "input table-input")} value={line.machineType} onChange={(e) => updateKnittingLine(i, "machineType", e.target.value)} disabled={readOnly}>
                    <option value="">Select machine...</option>
                    {KNITTING_REFERENCE.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                  {revisionFieldHint(`knittingLines.${i}.machineType`)}
                </td>
                <td><input className="input table-input" type="number" step="any" placeholder="0" value={line.knittingTime} onChange={(e) => updateKnittingLine(i, "knittingTime", e.target.value)} disabled={readOnly} /></td>
                <td><input className="input table-input" type="number" step="any" placeholder="0.00" value={line.sah} onChange={(e) => updateKnittingLine(i, "sah", e.target.value)} disabled={readOnly} /></td>
                <td><strong>{line.knittingCost ? parseFloat(line.knittingCost).toFixed(2) : "0.00"}</strong></td>
                <td>{!readOnly && <button type="button" className="icon-button" onClick={() => removeKnittingLine(i)}><IconTrash size={14} /></button>}</td>
              </tr>
            ))}
            {knittingLines.length === 0 && <tr><td colSpan={5} className="text-center text-muted">No knitting lines.</td></tr>}
          </tbody>
        </table>
        {!readOnly && <button type="button" className="button secondary small" onClick={addKnittingLine} style={{ marginTop: 8 }}><IconPlus size={14} /> Add Knitting</button>}

        <h3 style={{ marginTop: 24 }}>Operations</h3>
        <table className="table compact">
          <thead>
            <tr>
              <th>Operation</th>
              <th style={{ width: 140 }}>Operation Cost (USD)</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {operationLines.map((line, i) => (
              <tr key={i}>
                <td>
                  <select className="input table-input" value={line.operation} onChange={(e) => updateOperationLine(i, "operation", e.target.value)} disabled={readOnly}>
                    <option value="">Select operation...</option>
                    {OPERATIONS_REFERENCE.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
                <td><input className="input table-input" type="number" step="any" placeholder="0.00" value={line.operationCost} onChange={(e) => updateOperationLine(i, "operationCost", e.target.value)} disabled={readOnly} /></td>
                <td>{!readOnly && <button type="button" className="icon-button" onClick={() => removeOperationLine(i)}><IconTrash size={14} /></button>}</td>
              </tr>
            ))}
            {operationLines.length === 0 && <tr><td colSpan={3} className="text-center text-muted">No operations.</td></tr>}
          </tbody>
        </table>
        {!readOnly && <button type="button" className="button secondary small" onClick={addOperationLine} style={{ marginTop: 8 }}><IconPlus size={14} /> Add Operation</button>}
        <div className="field full" style={{ marginTop: 12 }}>
          <label htmlFor="operationsNotes">Operations Factory Notes</label>
          <input id="operationsNotes" name="operationsNotes" className="input" placeholder="Notes about operations performed" value={operationsNotes} onChange={(e) => setOperationsNotes(e.target.value)} disabled={readOnly} />
        </div>

        <div className="summary-bar" style={{ marginTop: 16 }}>
          <strong>Knitting Total: USD {knittingTotal.toFixed(2)}</strong>
          <span style={{ marginLeft: 16 }}><strong>Operations Total: USD {operationsTotal.toFixed(2)}</strong></span>
        </div>
        <div className="wizard-nav">
          <button type="button" className="button secondary" onClick={prevStep}><IconArrowLeft size={14} /> Back</button>
          <button type="button" className="button" onClick={nextStep}>Next: Packaging & Overhead <IconArrowRight size={14} /></button>
        </div>
      </div>

      {/* Step 5: Packaging & Overhead/Profit */}
      <div className="form-section-card" style={{ display: currentStep === 4 ? "block" : "none" }}>
        <h3>Packaging</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="standardPackagingCost">Standard Packaging Cost (USD)</label>
            <input id="standardPackagingCost" name="standardPackagingCost" className={revisionFieldClass("standardPackagingCost")} placeholder="0.10" value={costFields.standardPackagingCost} onChange={(event) => setCostFields((current) => ({ ...current, standardPackagingCost: event.target.value }))} disabled={readOnly} />
            {revisionFieldHint("standardPackagingCost")}
            <p className="eyebrow" style={{ marginTop: 4, fontSize: 11 }}>
              Options: {PACKAGING_REFERENCE.join(", ")}
            </p>
          </div>
          <div className="field">
            <label htmlFor="specialPackagingCost">Special Packaging Cost (USD)</label>
            <input id="specialPackagingCost" name="specialPackagingCost" className="input" placeholder="0.00" value={costFields.specialPackagingCost} onChange={(event) => setCostFields((current) => ({ ...current, specialPackagingCost: event.target.value }))} disabled={readOnly} />
          </div>
        </div>
        <div className="field full" style={{ marginTop: 8 }}>
          <label htmlFor="packagingNotes">Packaging Factory Notes</label>
          <input id="packagingNotes" name="packagingNotes" className="input" placeholder="Notes about packaging materials used" value={packagingNotes} onChange={(e) => setPackagingNotes(e.target.value)} disabled={readOnly} />
        </div>

        <h3 style={{ marginTop: 24 }}>Overhead / Profit</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="overheadCost">Overhead (USD)</label>
            <input id="overheadCost" name="overheadCost" className="input" placeholder="0.20" value={costFields.overheadCost} onChange={(event) => setCostFields((current) => ({ ...current, overheadCost: event.target.value }))} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="profitCost">Profit (USD)</label>
            <input id="profitCost" name="profitCost" className={revisionFieldClass("profitCost")} placeholder="0.26" value={costFields.profitCost} onChange={(event) => setCostFields((current) => ({ ...current, profitCost: event.target.value }))} disabled={readOnly} />
            {revisionFieldHint("profitCost")}
          </div>
        </div>
        <div className="field full" style={{ marginTop: 8 }}>
          <label htmlFor="overheadNotes">Overhead/Profit Factory Notes</label>
          <input id="overheadNotes" name="overheadNotes" className="input" placeholder="Notes about overhead and profit margins" value={overheadNotes} onChange={(e) => setOverheadNotes(e.target.value)} disabled={readOnly} />
        </div>

        <div className="summary-bar" style={{ marginTop: 16 }}>
          <strong>TOTAL FACTORY COST: USD {factoryCostEstimate.toFixed(5)}</strong>
        </div>
        <div className="wizard-nav">
          <button type="button" className="button secondary" onClick={prevStep}><IconArrowLeft size={14} /> Back</button>
          <button type="button" className="button" onClick={nextStep}>Next: Notes <IconArrowRight size={14} /></button>
        </div>
      </div>

      {/* Step 6: Notes */}
      <div className="form-section-card" style={{ display: currentStep === 5 ? "block" : "none" }}>
        <h3>Notes & Learnings</h3>
        <div className="field full" style={{ marginTop: 16 }}>
          <label htmlFor="notes">Factory Notes</label>
          <textarea id="notes" name="notes" className={revisionFieldClass("notes", "input textarea")} defaultValue={header.notes ?? ""} disabled={readOnly}></textarea>
          {revisionFieldHint("notes")}
        </div>
        <div className="field full" style={{ marginTop: 16 }}>
          <label htmlFor="costingLearning">Costing Notes / Learnings</label>
          <textarea id="costingLearning" name="costingLearning" className="input textarea" defaultValue={header.costingLearning ?? ""} disabled={readOnly}></textarea>
        </div>
        <div className="field full" style={{ marginTop: 16 }}>
          <label htmlFor="recurringIssueTags">Recurring Issue Tags</label>
          <input id="recurringIssueTags" name="recurringIssueTags" className="input" placeholder="comma-separated: packaging, buffer, supplier" defaultValue={header.recurringIssueTags ?? ""} disabled={readOnly} />
        </div>

        <div className="wizard-nav">
          <button type="button" className="button secondary" onClick={prevStep}><IconArrowLeft size={14} /> Back</button>
          <button type="button" className="button" onClick={nextStep}>Next: Review & Submit <IconArrowRight size={14} /></button>
        </div>
      </div>

      {/* Step 7: Submit */}
      <div className="form-section-card" style={{ display: currentStep === 6 ? "block" : "none" }}>
        <h3>Review & Submit</h3>
        <div className="cbd-review-summary">
          <div className="review-row"><span className="eyebrow">Customer / Season</span><strong>{reviewHeader.customer || "—"} / {reviewHeader.season || "—"}</strong></div>
          <div className="review-row"><span className="eyebrow">Style # / Name</span><strong>{reviewHeader.styleNumber || "—"} / {reviewHeader.styleName || "—"}</strong></div>
          <div className="review-row"><span className="eyebrow">Lead Time</span><strong>{reviewHeader.leadTimeDays || "—"} days</strong></div>
          <div className="review-row"><span className="eyebrow">Yarn Lines</span><strong>{yarnLines.filter(l => l.name).length} item(s) — USD {yarnTotal.toFixed(5)}</strong></div>
          <div className="review-row"><span className="eyebrow">Fabric / Trim</span><strong>{fabricLines.filter(l => l.name).length} / {trimLines.filter(l => l.name).length} item(s)</strong></div>
          <div className="review-row"><span className="eyebrow">Knitting</span><strong>{knittingLines.filter(l => l.machineType).length} line(s) — USD {knittingTotal.toFixed(2)}</strong></div>
          <div className="review-row"><span className="eyebrow">Operations</span><strong>{operationLines.filter(l => l.operation).length} op(s) — USD {operationsTotal.toFixed(2)}</strong></div>
          <div className="review-row"><span className="eyebrow">Material Total</span><strong>USD {materialTotal.toFixed(5)}</strong></div>
          <div className="review-row"><span className="eyebrow">Total Factory Cost (est.)</span><strong>USD {factoryCostEstimate.toFixed(5)}</strong></div>
        </div>
        {readOnly ? null : (
          <p className="notice">Review the summary above. Click <strong>Save Draft</strong> to continue later, or <strong>Submit for MD Review</strong> to send for MD technical review (then Costing).</p>
        )}
        <div className="wizard-nav">
          <button type="button" className="button secondary" onClick={prevStep}><IconArrowLeft size={14} /> Back</button>
          <div className="form-actions" style={{ flex: 1 }}>
            {readOnly ? (
              <span className="eyebrow">Read-only mode — editing is locked.</span>
            ) : (
              <>
                <button className="button secondary" type="submit" disabled={state === "saving"}>
                  {state === "saving" ? <><span className="spinner" /> Saving...</> : "Save Draft"}
                </button>
                <button className="button" type="button" disabled={state === "saving"} onClick={() => save("submitted")}>
                  {state === "saving" ? <><span className="spinner" /> Submitting...</> : "Submit for MD Review"}
                </button>
                {message ? <span className={`form-message ${state}`}>{message}</span> : null}
              </>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

function getHeaderDefaults(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== "object") return {};
  const payload = rawPayload as Record<string, unknown>;
  const headerInfo = payload.header as Record<string, unknown> | undefined;
  return {
    customer: headerInfo?.customer as string ?? undefined,
    season: headerInfo?.season as string ?? undefined,
    styleNumber: headerInfo?.styleNumber as string ?? undefined,
    styleName: headerInfo?.styleName as string ?? undefined,
    costedQty: headerInfo?.costedQty as string ?? undefined,
    leadTimeDays: headerInfo?.leadTimeDays != null ? String(headerInfo.leadTimeDays) : undefined,
    finishWeight: headerInfo?.finishWeight as string ?? undefined,
    protoVersion: headerInfo?.protoVersion as string ?? undefined,
    moq: payload.moq != null ? String(payload.moq) : undefined,
    materialBufferPercent: payload.materialBufferPercent != null ? String(payload.materialBufferPercent) : undefined,
    testingCost: payload.testingCost != null ? String(payload.testingCost) : undefined,
    brandNominatedItems: payload.brandNominatedItems as string ?? undefined,
    m88Packaging: payload.m88Packaging as string ?? undefined,
    yarnType: payload.yarnType as string ?? undefined,
    knitType: payload.knitType as string ?? undefined,
    machineType: payload.machineType as string ?? undefined,
    construction: payload.construction as string ?? undefined,
    productCategory: payload.productCategory as string ?? undefined,
    standardPackagingCost: payload.standardPackagingCost != null ? String(payload.standardPackagingCost) : undefined,
    specialPackagingCost: payload.specialPackagingCost != null ? String(payload.specialPackagingCost) : undefined,
    overheadCost: payload.overheadCost != null ? String(payload.overheadCost) : undefined,
    profitCost: payload.profitCost != null ? String(payload.profitCost) : undefined,
    yarnNotes: payload.yarnNotes as string ?? undefined,
    notes: payload.notes as string ?? undefined,
    costingLearning: payload.costingLearning as string ?? undefined,
    recurringIssueTags: Array.isArray(payload.recurringIssueTags) ? (payload.recurringIssueTags as string[]).join(", ") : typeof payload.recurringIssueTags === "string" ? payload.recurringIssueTags : undefined,
  };
}

function getExistingLines(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== "object") return { yarn: [] as YarnLine[], fabric: [] as FabricLine[], trim: [] as TrimLine[], knitting: [] as KnittingLine[], operations: [] as OperationLine[], operationsNotes: "", packagingNotes: "", overheadNotes: "" };
  const payload = rawPayload as Record<string, unknown>;
  const rawYarn = (Array.isArray(payload.yarnLines) ? payload.yarnLines : []) as Array<Record<string, unknown>>;
  return {
    yarn: rawYarn.map(l => ({
      name: String(l.name ?? ""),
      consumption: String(l.consumption ?? ""),
      fobPrice: String(l.fobPrice ?? ""),
      surchargePercent: String(l.surchargePercent ?? ""),
      freightCost: String(l.freightCost ?? ""),
      markupPercent: String(l.markupPercent ?? ""),
      materialPrice: String(l.materialPrice ?? ""),
      materialCost: String(l.materialCost ?? ""),
      showCalc: false
    })) as YarnLine[],
    fabric: (Array.isArray(payload.fabricLines) ? payload.fabricLines : []) as FabricLine[],
    trim: (Array.isArray(payload.trimLines) ? payload.trimLines : []) as TrimLine[],
    knitting: (Array.isArray(payload.knittingLines) ? payload.knittingLines : []) as KnittingLine[],
    operations: (Array.isArray(payload.operationsLines) ? payload.operationsLines : []) as OperationLine[],
    operationsNotes: typeof payload.operationsNotes === "string" ? payload.operationsNotes : "",
    packagingNotes: typeof payload.packagingNotes === "string" ? payload.packagingNotes : "",
    overheadNotes: typeof payload.overheadNotes === "string" ? payload.overheadNotes : "",
  };
}
