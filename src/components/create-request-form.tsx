"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "@/components/ui/toast";
import { SkeletonTable } from "@/components/ui/skeleton";
import { ProductImage } from "@/components/product-image";
import { isHistoricalNextGenStatus, nextGenMetaOf, type NextGenProductMeta } from "@/lib/nextgen/product-meta";
import { buildBaselineNote, buildBaselineRef, type HistoricalCostingRow } from "@/lib/costing/history";

type SubmitState = "idle" | "saving" | "saved" | "error";
type SearchState = "idle" | "searching" | "done" | "error";
type BomState = "idle" | "loading" | "done" | "error";
type PoResult = {
  id: string;
  name: string;
  status?: string;
  supplierName?: string;
  customerName?: string;
  totalCost?: number;
  currencyName?: string;
  raw?: unknown;
};
type ProductResult = NextGenProductMeta & {
  description?: string;
};
type BomLine = {
  id: string;
  category: string;
  materialName: string;
  materialDescription?: string;
  materialType?: string;
  usage?: string | number;
  size?: string;
  headerVersion?: string;
  bomVersionComment?: string;
};



export function CreateRequestForm({
  initialStyle,
  baseline
}: {
  initialStyle?: string;
  baseline?: HistoricalCostingRow | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<SubmitState>("idle");
  const [searchState, setSearchState] = useState<SearchState>(initialStyle ? "idle" : "idle");
  const [bomState, setBomState] = useState<BomState>("idle");
  const [message, setMessage] = useState("");
  const [searchMessage, setSearchMessage] = useState(initialStyle ? `Searching for style "${initialStyle}"...` : "");
  const [bomMessage, setBomMessage] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [selected, setSelected] = useState<ProductResult | null>(null);
  const [bomLines, setBomLines] = useState<BomLine[]>([]);
  const [bomVersion, setBomVersion] = useState<{ version?: string; comment?: string }>({});
  const [forceCreateData, setForceCreateData] = useState<any>(null);
  const [poResults, setPoResults] = useState<PoResult[]>([]);
  const [poSearchState, setPoSearchState] = useState<SearchState>("idle");
  const [poSearchMessage, setPoSearchMessage] = useState("");
  const [mpoResults, setMpoResults] = useState<PoResult[]>([]);
  const [mpoSearchState, setMpoSearchState] = useState<SearchState>("idle");
  const [mpoSearchMessage, setMpoSearchMessage] = useState("");
  // Baseline reference — either the ?baseline= prop or one picked from the
  // historical library inside the form.
  const [activeBaseline, setActiveBaseline] = useState<HistoricalCostingRow | null>(baseline ?? null);
  const [showBaselinePicker, setShowBaselinePicker] = useState(false);
  const [baselineQuery, setBaselineQuery] = useState("");
  const [baselineResults, setBaselineResults] = useState<HistoricalCostingRow[]>([]);
  const [baselineSearching, setBaselineSearching] = useState(false);
  const [baselineError, setBaselineError] = useState("");

  // Auto-search when initialStyle is provided (e.g. from History benchmark button)
  useEffect(() => {
    if (!initialStyle) return;
    const styleInput = document.getElementById("styleNumber") as HTMLInputElement | null;
    if (styleInput) styleInput.value = initialStyle;
    searchProduct();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStyle]);

  // Keep the active baseline in sync with the ?baseline= prop (e.g. navigating
  // between Like Styles "Copy baseline" links without a full remount).
  useEffect(() => {
    if (baseline && baseline.id !== activeBaseline?.id) setActiveBaseline(baseline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline]);

  // Copy the active baseline's attributes into every form field the approved
  // row carries (cost reference stays visible in the banner and is recorded on
  // the request as baseline_ref + in the notes).
  useEffect(() => {
    if (!activeBaseline) return;
    const setValue = (id: string, value: string | null | undefined) => {
      const input = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      if (input && !input.value.trim() && value) input.value = value;
    };
    setValue("factoryName", activeBaseline.factory_name);
    setValue("productCategory", activeBaseline.product_category);
    setValue("season", activeBaseline.season);
    setValue("brand", activeBaseline.brand);
    setValue("customer", activeBaseline.customer);
    setValue("notes", activeBaseline.searchable_text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBaseline]);

  // Search the approved-cost library to pick a baseline from inside the form.
  async function searchBaselines() {
    const query = baselineQuery.trim();
    if (!query) return;
    setBaselineSearching(true);
    setBaselineError("");
    try {
      const response = await fetch(`/api/historical/search?q=${encodeURIComponent(query)}&limit=20`);
      const body = await response.json();
      if (!response.ok || !body.ok) {
        setBaselineError(body.error ?? "Unable to search historical costings");
        setBaselineResults([]);
      } else {
        setBaselineResults(body.data ?? []);
      }
    } catch {
      setBaselineError("Search failed — check the connection and retry.");
      setBaselineResults([]);
    } finally {
      setBaselineSearching(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    setMessage("");

    const form = new FormData(event.currentTarget);
    const payload = {
      styleNumber: String(form.get("styleNumber") ?? "").trim(),
      productName: String(form.get("productName") ?? "").trim() || selected?.name,
      nextgenEntityId: selected?.entityId,
      nextgenRaw: selected?.raw,
      bomLines,
      factoryName: String(form.get("factoryName") ?? "").trim(),
      season: String(form.get("season") ?? "").trim(),
      brand: String(form.get("brand") ?? "").trim(),
      customer: String(form.get("customer") ?? "").trim(),
      poNumber: String(form.get("poNumber") ?? "").trim(),
      mpoNumber: String(form.get("mpoNumber") ?? "").trim(),
      productCategory: String(form.get("productCategory") ?? "").trim(),
      buyerStyleNumber: String(form.get("buyerStyleNumber") ?? "").trim(),
      notes: [String(form.get("notes") ?? "").trim(), buildBaselineNote(activeBaseline)].filter(Boolean).join("\n"),
      baselineRef: activeBaseline ? buildBaselineRef(activeBaseline) : undefined
    };

    const response = await fetch("/api/costing/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    // Handle duplicate detection (409 Conflict)
    if (response.status === 409 && result.duplicates) {
      setState("error");
      const dupList = result.duplicates.map((d: any) =>
        `${d.request_number} (${d.status}${d.factory_name ? `, ${d.factory_name}` : ""})`
      ).join(", ");
      setMessage(`Duplicate detected: ${dupList}. Click "Create Anyway" to override.`);
      toast.add({ type: "warning", description: `Duplicate detected: ${dupList}` });
      setForceCreateData(payload);
      return;
    }

    if (!response.ok || !result.ok) {
      setState("error");
      const errMsg = result.error ?? "Unable to create request";
      setMessage(errMsg);
      toast.add({ type: "error", description: errMsg, priority: "high" });
      return;
    }

    setState("saved");
    setMessage(`Created ${result.data.request_number}. Opening request...`);
    toast.add({ type: "success", description: `Created ${result.data.request_number}` });
    router.refresh();
    router.push(`/requests/${result.data.id}`);
  }

  async function createAnyway() {
    if (!forceCreateData) return;
    setState("saving");
    setMessage("");

    const response = await fetch("/api/costing/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...forceCreateData, forceCreate: true })
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      setState("error");
      setMessage(result.error ?? "Unable to create request");
      return;
    }

    setState("saved");
    setForceCreateData(null);
    setMessage(`Created ${result.data.request_number}. Opening request...`);
    router.refresh();
    router.push(`/requests/${result.data.id}`);
  }

  async function searchProduct() {
    const styleInput = document.getElementById("styleNumber") as HTMLInputElement | null;
    const query = styleInput?.value.trim();

    if (!query) {
      setSearchState("error");
      setSearchMessage("Enter a style or product first");
      return;
    }

    setSearchState("searching");
    setSearchMessage("");
    setResults([]);
    setSelected(null);
    setBomLines([]);
    setBomVersion({});
    setBomState("idle");
    setBomMessage("");

    const response = await fetch(`/api/product/search?q=${encodeURIComponent(query)}`);
    const result = await response.json();

    if (!response.ok || !result.ok) {
      setSearchState("error");
      setSearchMessage(result.error ?? `NextGen returned status ${result.status ?? response.status}`);
      return;
    }

    const data = Array.isArray(result.data) ? result.data : [];

    setResults(data);
    setSearchState("done");
    setSearchMessage(data.length ? `${data.length} result(s) found` : "No product rows returned");
  }

  async function searchPo() {
    const poInput = document.getElementById("poNumber") as HTMLInputElement | null;
    const query = poInput?.value.trim();

    if (!query) {
      setPoSearchState("error");
      setPoSearchMessage("Enter a PO number or keyword first");
      return;
    }

    setPoSearchState("searching");
    setPoSearchMessage("");
    setPoResults([]);

    const response = await fetch(`/api/nextgen/po/search?q=${encodeURIComponent(query)}`);
    const result = await response.json();

    if (!response.ok || !result.ok) {
      setPoSearchState("error");
      setPoSearchMessage(result.error ?? `NextGen returned status ${result.status ?? response.status}`);
      return;
    }

    const rows = (result.body?.Data ?? result.body?.data ?? result.data ?? []) as Record<string, unknown>[];
    const normalized: PoResult[] = rows.map((row) => ({
      id: String(row.Id ?? row.id ?? ""),
      name: String(row.Name ?? row.Name ?? row.OrderNumber ?? ""),
      status: (row.StatusName as string) ?? undefined,
      supplierName: (row.SupplierName as string) ?? undefined,
      customerName: (row.CustomerName as string) ?? undefined,
      totalCost: typeof row.TotalCost === "number" ? row.TotalCost : undefined,
      currencyName: (row.CurrencyName as string) ?? undefined,
      raw: row
    })).filter((r) => r.id || r.name);

    setPoResults(normalized);
    setPoSearchState("done");
    setPoSearchMessage(normalized.length ? `${normalized.length} PO(s) found` : "No POs found");
  }

  function choosePo(po: PoResult) {
    const poInput = document.getElementById("poNumber") as HTMLInputElement | null;
    if (poInput) poInput.value = po.name;
    setPoResults([]);
    setPoSearchMessage(`Selected: ${po.name}`);
  }

  async function searchMpo() {
    const mpoInput = document.getElementById("mpoNumber") as HTMLInputElement | null;
    const query = mpoInput?.value.trim();

    if (!query) {
      setMpoSearchState("error");
      setMpoSearchMessage("Enter an MPO number or keyword first");
      return;
    }

    setMpoSearchState("searching");
    setMpoSearchMessage("");
    setMpoResults([]);

    const response = await fetch(`/api/nextgen/mpo/search?q=${encodeURIComponent(query)}`);
    const result = await response.json();

    if (!response.ok || !result.ok) {
      setMpoSearchState("error");
      setMpoSearchMessage(result.error ?? `NextGen returned status ${result.status ?? response.status}`);
      return;
    }

    const rows = (result.body?.Data ?? result.body?.data ?? result.data ?? []) as Record<string, unknown>[];
    const normalized: PoResult[] = rows.map((row) => ({
      id: String(row.Id ?? row.id ?? ""),
      name: String(row.Name ?? row.name ?? row.MPONumber ?? ""),
      status: (row.StatusName as string) ?? undefined,
      supplierName: (row.SupplierName as string) ?? undefined,
      customerName: (row.CustomerName as string) ?? undefined,
      totalCost: typeof row.TotalCost === "number" ? row.TotalCost : undefined,
      currencyName: (row.CurrencyName as string) ?? undefined,
      raw: row
    })).filter((r) => r.id || r.name);

    setMpoResults(normalized);
    setMpoSearchState("done");
    setMpoSearchMessage(normalized.length ? `${normalized.length} MPO(s) found` : "No MPOs found");
  }

  function chooseMpo(mpo: PoResult) {
    const mpoInput = document.getElementById("mpoNumber") as HTMLInputElement | null;
    if (mpoInput) mpoInput.value = mpo.name;
    setMpoResults([]);
    setMpoSearchMessage(`Selected: ${mpo.name}`);
  }

  function chooseProduct(product: ProductResult) {
    setSelected(product);
    setBomLines([]);
    setBomVersion({});
    setBomState("idle");
    setBomMessage("");

    // Extract fields from raw NextGen product data for auto-fill
    const raw = (product.raw ?? {}) as Record<string, unknown>;
    const firstString = (keys: string[]) => {
      for (const key of keys) {
        const v = raw[key];
        if (typeof v === "string" && v.trim()) return v.trim();
        if (typeof v === "number") return String(v);
      }
      return "";
    };

    const factoryName = firstString([
      "DefaultProductCostingCostingProductSupplierName",
      "ProductSupplierName",
      "SupplierName"
    ]);
    const season = firstString(["RangeName", "SeasonName", "CollectionName"]);
    const brand = firstString(["DepartmentName", "BrandName", "DivisionName"]);
    const customer = firstString(["CustomerName", "CustomerReference"]);
    const productCategory = firstString(["CommodityTypeName", "ProductType", "ProductCategory"]);
    const buyerStyleNumber = firstString(["ExternalReference", "BuyerStyleNumber"]);
    const customerRef = firstString(["CustomerReference", "ExternalReference"]);
    const productName = firstString(["CustomerReference", "customerReference", "Description", "description"]) || product.name;

    const setVal = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el && value) el.value = value;
    };

    setVal("styleNumber", product.styleNumber);
    setVal("productName", productName);
    setVal("factoryName", factoryName);
    setVal("season", season);
    setVal("brand", brand);
    setVal("customer", customer);
    setVal("productCategory", productCategory);
    setVal("buyerStyleNumber", buyerStyleNumber);

    // If customer ref exists and notes field is empty, don’t override
    if (customerRef) {
      const notesEl = document.getElementById("notes") as HTMLTextAreaElement | null;
      if (notesEl && !notesEl.value) {
        notesEl.value = `Customer ref: ${customerRef}`;
      }
    }
  }

  async function loadBom() {
    if (!selected?.entityId) {
      setBomState("error");
      setBomMessage("Select a NextGen product first");
      return;
    }

    setBomState("loading");
    setBomMessage("");

    const response = await fetch(`/api/product/${encodeURIComponent(selected.entityId)}/bom`);
    const result = await response.json();

    if (!response.ok || !result.ok) {
      setBomState("error");
      setBomMessage(result.error ?? `NextGen BOM returned status ${result.status ?? response.status}`);
      return;
    }

    const data = Array.isArray(result.data) ? result.data : [];
    setBomLines(data);
    setBomVersion({
      version: data[0]?.headerVersion,
      comment: data[0]?.bomVersionComment
    });
    setBomState("done");
    setBomMessage(data.length ? `${data.length} BOM line(s) loaded` : "No BOM lines returned");
  }

  return (
    <form onSubmit={submit} className="panel">
      {activeBaseline ? (
        <div className="baseline-banner">
          <div>
            <strong>Baseline: {activeBaseline.style_number ?? "historical style"}</strong>
            <p className="eyebrow">
              {[activeBaseline.factory_name, `${activeBaseline.currency ?? "USD"} ${activeBaseline.total_cost?.toFixed(2) ?? "—"}`, activeBaseline.product_category].filter(Boolean).join(" · ")}
              {activeBaseline.costing_request_id ? (
                <> · <Link href={`/requests/${activeBaseline.costing_request_id}`}>open approved costing</Link></>
              ) : null}
            </p>
            <p className="eyebrow">
              {[
                activeBaseline.yarn_type ? `Yarn: ${activeBaseline.yarn_type}` : null,
                activeBaseline.knit_type ? `Knit: ${activeBaseline.knit_type}` : null,
                activeBaseline.machine_type ? `Machine: ${activeBaseline.machine_type}` : null,
                activeBaseline.construction ? `Construction: ${activeBaseline.construction}` : null,
                activeBaseline.average_consumption != null ? `Cons.: ${activeBaseline.average_consumption.toFixed(2)} kg` : null,
                activeBaseline.knitting_time != null ? `Knit time: ${activeBaseline.knitting_time.toFixed(2)} min` : null
              ]
                .filter(Boolean)
                .join(" · ") || "No attribute data on the source costing"}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <p className="eyebrow">Cost and attributes copied from this approved costing. The reference is saved on the request and shown to the factory while they fill the CBD.</p>
            <button className="button secondary small-btn" type="button" onClick={() => setActiveBaseline(null)}>
              Clear baseline
            </button>
          </div>
        </div>
      ) : (
        <button
          className="button secondary small-btn"
          type="button"
          onClick={() => setShowBaselinePicker((show) => !show)}
        >
          {showBaselinePicker ? "Hide baseline picker" : "Pick a baseline from historical costings"}
        </button>
      )}

      {showBaselinePicker ? (
        <div className="baseline-picker">
          <p className="eyebrow">
            Search the approved-cost library (style, factory, yarn, keyword) and copy a comparable costing in as the baseline.
          </p>
          <div className="input-row">
            <input
              className="input"
              placeholder="e.g. M8833541, Acrylic, Hangzhou..."
              value={baselineQuery}
              onChange={(e) => setBaselineQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  searchBaselines();
                }
              }}
              disabled={baselineSearching}
            />
            <button className="button secondary" type="button" onClick={searchBaselines} disabled={baselineSearching}>
              {baselineSearching ? "Searching…" : "Search"}
            </button>
          </div>
          {baselineError ? <p className="action-error">{baselineError}</p> : null}
          {baselineResults.length ? (
            <ul className="list compact-list">
              {baselineResults.map((row) => (
                <li key={row.id}>
                  <strong>{row.style_number ?? "No style"}</strong>
                  <span className="eyebrow">
                    {" "}· {row.factory_name ?? "Unassigned"} · {row.currency ?? "USD"} {row.total_cost?.toFixed(2) ?? "—"}
                    {row.yarn_type || row.knit_type || row.machine_type
                      ? ` · ${[row.yarn_type, row.knit_type, row.machine_type].filter(Boolean).join(" / ")}`
                      : ""}
                  </span>
                  <br />
                  <button
                    className="button secondary small-btn"
                    type="button"
                    disabled={activeBaseline?.id === row.id}
                    onClick={() => {
                      setActiveBaseline(row);
                      setShowBaselinePicker(false);
                      setBaselineResults([]);
                      setBaselineQuery("");
                    }}
                  >
                    {activeBaseline?.id === row.id ? "Selected" : "Use as baseline"}
                  </button>
                  {row.costing_request_id ? (
                    <Link className="table-action" href={`/requests/${row.costing_request_id}`}>
                      Open approved costing
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : baselineSearching ? null : baselineQuery.trim() ? (
            <p className="eyebrow">No historical costings match that search.</p>
          ) : null}
        </div>
      ) : null}
      <h2>Source Details</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="styleNumber">Style or Product</label>
          <div className="input-row">
            <input id="styleNumber" name="styleNumber" className="input" placeholder="M8819347" required />
            <button
              className="button secondary"
              type="button"
              onClick={searchProduct}
              disabled={searchState === "searching" || state === "saving"}
            >
              {searchState === "searching" ? <><span className="spinner" /> Searching...</> : "Search"}
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="productName">Product Name</label>
          <input id="productName" name="productName" className="input" placeholder="Optional" />
        </div>
        <div className="field">
          <label htmlFor="factoryName">Factory</label>
          <input id="factoryName" name="factoryName" className="input" placeholder="Select or type factory" />
        </div>
        <div className="field">
          <label htmlFor="season">Season</label>
          <input id="season" name="season" className="input" placeholder="e.g. SS27" />
        </div>
        <div className="field">
          <label htmlFor="brand">Brand</label>
          <input id="brand" name="brand" className="input" placeholder="Brand/customer line" />
        </div>
        <div className="field">
          <label htmlFor="customer">Customer</label>
          <input id="customer" name="customer" className="input" placeholder="Customer account" />
        </div>
        <div className="field">
          <label htmlFor="buyerStyleNumber">Buyer Style Number</label>
          <input id="buyerStyleNumber" name="buyerStyleNumber" className="input" placeholder="e.g. 21711-A" />
        </div>
        <div className="field">
          <label htmlFor="productCategory">Product Type</label>
          <input id="productCategory" name="productCategory" className="input" placeholder="e.g. Hats" />
        </div>
        <div className="field">
          <label htmlFor="poNumber">PO Number</label>
          <div className="input-row">
            <input id="poNumber" name="poNumber" className="input" placeholder="Optional — type PO name then Search" />
            <button
              className="button secondary"
              type="button"
              onClick={searchPo}
              disabled={poSearchState === "searching" || state === "saving"}
            >
              {poSearchState === "searching" ? <><span className="spinner" /> ...</> : "Search"}
            </button>
          </div>
          {poSearchMessage ? <p className={`form-message ${poSearchState}`} style={{ marginTop: 4 }}>{poSearchMessage}</p> : null}
          {poResults.length ? (
            <div className="result-list" style={{ marginTop: 4 }}>
              {poResults.slice(0, 8).map((po) => (
                <button
                  className="result-row"
                  key={po.id}
                  type="button"
                  onClick={() => choosePo(po)}
                >
                  <strong>{po.name}</strong>
                  <span>{po.status ?? ""} {po.supplierName ? `· ${po.supplierName}` : ""}</span>
                  {po.totalCost != null ? <small>{po.currencyName ?? "USD"} {po.totalCost}</small> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="mpoNumber">MPO Number</label>
          <div className="input-row">
            <input id="mpoNumber" name="mpoNumber" className="input" placeholder="Optional — type MPO name then Search" />
            <button
              className="button secondary"
              type="button"
              onClick={searchMpo}
              disabled={mpoSearchState === "searching" || state === "saving"}
            >
              {mpoSearchState === "searching" ? <><span className="spinner" /> ...</> : "Search"}
            </button>
          </div>
          {mpoSearchMessage ? <p className={`form-message ${mpoSearchState}`} style={{ marginTop: 4 }}>{mpoSearchMessage}</p> : null}
          {mpoResults.length ? (
            <div className="result-list" style={{ marginTop: 4 }}>
              {mpoResults.slice(0, 8).map((mpo) => (
                <button
                  className="result-row"
                  key={mpo.id}
                  type="button"
                  onClick={() => chooseMpo(mpo)}
                >
                  <strong>{mpo.name}</strong>
                  <span>{mpo.status ?? ""} {mpo.supplierName ? `· ${mpo.supplierName}` : ""}</span>
                  {mpo.totalCost != null ? <small>{mpo.currencyName ?? "USD"} {mpo.totalCost}</small> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="field full">
          <label htmlFor="notes">Notes for Factory</label>
          <textarea id="notes" name="notes" className="input textarea" placeholder="Add special costing instructions" />
        </div>
      </div>

      {searchMessage ? <p className={`form-message ${searchState}`}>{searchMessage}</p> : null}

      {results.length ? (
        <div className="result-list">
          {results.map((product) => (
            <button
              className={`result-row ${selected?.entityId === product.entityId ? "selected" : ""}`}
              key={`${product.entityId}-${product.styleNumber}`}
              type="button"
              onClick={() => chooseProduct(product)}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <ProductImage
                  entityId={product.entityId}
                  alt=""
                  width={48}
                  height={48}
                  style={{ borderRadius: 6 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{product.styleNumber}</strong>
                  <span>{product.name}</span>
                  {product.description ? <small>{product.description}</small> : null}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {selected ? (() => {
        const meta = nextGenMetaOf(selected);
        const isHistorical = isHistoricalNextGenStatus(meta.status);
        const hasCosting = Boolean(meta.purchasePrice || meta.sellingPrice || meta.costingName || meta.supplierName);

        return (
          <div className="bom-panel">
            <div className="toolbar">
              <div>
                <strong>Selected NextGen Product</strong>
                <p className="eyebrow">
                  {selected.styleNumber} / ID {selected.entityId}
                </p>
              </div>
              <button
                className="button secondary"
                type="button"
                onClick={loadBom}
                disabled={bomState === "loading" || state === "saving"}
              >
                {bomState === "loading" ? <><span className="spinner" /> Loading BOM...</> : "Load BOM"}
              </button>
            </div>

            {(meta.status || hasCosting || bomVersion.version) ? (
              <div className="nextgen-meta">
                {meta.status ? (
                  <div className="meta-item">
                    <span className="eyebrow">NextGen Status</span>
                    <strong className={isHistorical ? "status-historical" : undefined}>
                      {meta.status}
                    </strong>
                  </div>
                ) : null}
                {meta.externalReference ? (
                  <div className="meta-item">
                    <span className="eyebrow">External Reference (Buyer SKU)</span>
                    <strong>{meta.externalReference}</strong>
                  </div>
                ) : null}
                {meta.costingName ? (
                  <div className="meta-item">
                    <span className="eyebrow">Default Costing</span>
                    <strong>{meta.costingName}</strong>
                  </div>
                ) : null}
                {meta.purchasePrice || meta.sellingPrice ? (
                  <div className="meta-item">
                    <span className="eyebrow">NextGen Default Cost</span>
                    <strong>
                      {meta.purchasePrice ? `Purchase ${meta.currency || ""} ${meta.purchasePrice}` : null}
                      {meta.purchasePrice && meta.sellingPrice ? " · " : null}
                      {meta.sellingPrice ? `Selling ${meta.currency || ""} ${meta.sellingPrice}` : null}
                    </strong>
                  </div>
                ) : null}
                {meta.supplierName ? (
                  <div className="meta-item">
                    <span className="eyebrow">Costing Supplier</span>
                    <strong>{meta.supplierName}</strong>
                  </div>
                ) : null}
                {meta.originalName ? (
                  <div className="meta-item">
                    <span className="eyebrow">Developed From</span>
                    <strong>{meta.originalName}</strong>
                  </div>
                ) : null}
                {meta.composition ? (
                  <div className="meta-item">
                    <span className="eyebrow">Composition</span>
                    <strong>{meta.composition}</strong>
                  </div>
                ) : null}
                {meta.smv || meta.gsdSmv || meta.allowedTime || meta.factoryTime ? (
                  <div className="meta-item">
                    <span className="eyebrow">SMV / Labor (NextGen)</span>
                    <strong>
                      {[meta.smv ? `SMV ${meta.smv}` : null, meta.gsdSmv ? `GSD ${meta.gsdSmv}` : null, meta.allowedTime ? `Allowed ${meta.allowedTime}` : null, meta.factoryTime ? `Factory ${meta.factoryTime}` : null].filter(Boolean).join(" · ")}
                    </strong>
                  </div>
                ) : null}
                {bomVersion.version ? (
                  <div className="meta-item">
                    <span className="eyebrow">BOM Version</span>
                    <strong>
                      v{bomVersion.version}
                      {bomVersion.comment ? ` — ${bomVersion.comment}` : ""}
                    </strong>
                  </div>
                ) : null}
              </div>
            ) : null}

            {isHistorical ? (
              <p className="notice" role="note">
                <strong>{meta.status}</strong> ang status ng style na ito sa NextGen — historical/archived style.
                I-verify munang active pa ito bago gumawa ng request.
              </p>
            ) : null}

            {bomMessage ? <p className={`form-message ${bomState}`}>{bomMessage}</p> : null}
            {bomState === "loading" ? <SkeletonTable rows={4} /> : null}
            {bomLines.length ? (
              <div className="table-wrapper bom-table-wrapper">
                <table className="table compact bom-lines-table bom-lines-create-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Material</th>
                      <th>Usage</th>
                      <th>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bomLines.map((line) => (
                      <tr key={`${line.id}-${line.materialName}`}>
                        <td>{line.category || "Uncategorized"}</td>
                        <td>
                          <strong>{line.materialName}</strong>
                          {line.materialDescription ? (
                            <>
                              <br />
                              <span className="eyebrow">{line.materialDescription}</span>
                            </>
                          ) : null}
                        </td>
                        <td>{line.usage ?? "Pending"}</td>
                        <td>{line.size ?? "Pending"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        );
      })() : null}

      <div className="form-actions">
        <button className="button" type="submit" disabled={state === "saving"}>
          {state === "saving" ? <><span className="spinner" /> Creating...</> : "Create Draft"}
        </button>
        {forceCreateData ? (
          <button className="button secondary" type="button" onClick={createAnyway} disabled={state === "saving"}>
            {state === "saving" ? "Creating..." : "Create Anyway"}
          </button>
        ) : null}
        {message ? <span className={`form-message ${state}`}>{message}</span> : null}
      </div>
    </form>
  );
}
