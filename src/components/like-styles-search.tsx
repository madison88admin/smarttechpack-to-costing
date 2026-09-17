"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LikeStyleMatch, MachineSpeed } from "@/lib/costing/history";
import { CopyShareLink } from "@/components/copy-share-link";
import { SkeletonTable } from "@/components/ui/skeleton";
import {
  DEFAULT_LIKE_STYLES_FILTERS,
  hasLikeStylesCriteria,
  likeStylesFiltersToQuery,
  parseLikeStylesPrefs,
  serializeLikeStylesPrefs,
  type LikeStylesFilters
} from "@/lib/like-styles-prefs";



type SearchResponse = {
  ok: boolean;
  error?: string;
  data?: LikeStyleMatch[];
  benchmark?: {
    averageConsumption: number | null;
    averageKnittingTime: number | null;
    sampleSize: number;
    machineSpeeds?: MachineSpeed[];
  consumptionSampleSize?: number;
  knittingSampleSize?: number;
  };
};

const MIN_SCORE_OPTIONS = [0, 2, 4, 6, 8];
const STORAGE_KEY = "tp-costing:like-styles-filters";

type DistinctOptions = {
  yarnTypes: string[];
  knitTypes: string[];
  machineTypes: string[];
  constructions: string[];
  categories: string[];
  factories: string[];
  brands: string[];
  customers: string[];
  seasons: string[];
};

type NextGenFilterOptions = DistinctOptions;

function mergeOptions(...groups: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const value of groups.flat()) {
    const cleaned = value.trim();
    if (cleaned && !seen.has(cleaned.toLocaleLowerCase())) seen.set(cleaned.toLocaleLowerCase(), cleaned);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function LikeStylesSearch() {
  const [filters, setFilters] = useState<LikeStylesFilters>(DEFAULT_LIKE_STYLES_FILTERS);
  const [results, setResults] = useState<LikeStyleMatch[] | null>(null);
  const [resultsPage, setResultsPage] = useState(0);
  const [previewResultId, setPreviewResultId] = useState<string | null>(null);
  const [benchmark, setBenchmark] = useState<SearchResponse["benchmark"] | null>(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [distinct, setDistinct] = useState<DistinctOptions>({
    yarnTypes: [],
    knitTypes: [],
    machineTypes: [],
    constructions: [],
    categories: [],
    factories: [],
    brands: [],
    customers: [],
    seasons: [],
  });
  // Serialized filters of the last executed search — the auto-search effect
  // compares against this so picking the same values twice never refires.
  const lastSearchedRef = useRef("");
  // The query that produced the current results — reuse it for the CSV/XLSX
  // export links so the saved comparison set matches what is on screen.
  const [lastQuery, setLastQuery] = useState("");
  // Saving a named comparison set (shared link for PBD/Costing review).
  const [saveName, setSaveName] = useState("");
  const [savingSet, setSavingSet] = useState(false);
  const [savedShareUrl, setSavedShareUrl] = useState("");
  const [saveError, setSaveError] = useState("");
  const [nextGenDirectoryState, setNextGenDirectoryState] = useState<"loading" | "live" | "partial" | "unavailable">("loading");
  const [lastDirectoryRefresh, setLastDirectoryRefresh] = useState<Date | null>(null);

  function setField(field: keyof LikeStylesFilters, value: string | number) {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }

  async function saveSet() {
    if (!results?.length) return;
    setSavingSet(true);
    setSaveError("");
    try {
      const response = await fetch("/api/comparison-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName.trim(),
          filters,
          results,
          benchmark
        })
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        setSaveError(body.error ?? "Unable to save comparison set");
      } else {
        setSavedShareUrl(`${window.location.origin}/comparison-sets/${body.set.shareToken}`);
        setSaveName("");
      }
    } catch {
      setSaveError("Unable to save comparison set — check the connection and retry.");
    } finally {
      setSavingSet(false);
    }
  }

  function persistFilters(next: LikeStylesFilters) {
    try {
      localStorage.setItem(STORAGE_KEY, serializeLikeStylesPrefs(next));
    } catch {
      // Storage unavailable (private mode) — degrade gracefully.
    }
  }

  // Stable: only uses state setters, so the mount restore effect can depend on
  // it without re-running the search on every keystroke.
  const runSearch = useCallback(async (filtersToUse: LikeStylesFilters, event?: React.FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    setError("");
    try {
      const query = likeStylesFiltersToQuery(filtersToUse);
      const response = await fetch(`/api/historical/like-styles?${query}`);
      const body = (await response.json()) as SearchResponse;
      if (!response.ok || !body.ok) {
        setError(body.error ?? "Unable to search like styles");
        setResults(null);
        setBenchmark(null);
      } else {
        setResults(body.data ?? []);
        setResultsPage(0);
        setPreviewResultId(null);
        setBenchmark(body.benchmark ?? null);
        setSearched(true);
        setLastQuery(query);
      }
    } catch {
      setError("Search failed — check the connection and retry.");
      setResults(null);
      setBenchmark(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // The approved-cost library remains the source for comparison results. The
  // available filter directory is also fetched live from NextGen (Products +
  // PO lines), so current values are selectable before historical sync.
  useEffect(() => {
    // Do not block the usable historical menus behind a slower NextGen call.
    // Each source updates the same directory independently.
    fetch("/api/historical/distinct")
      .then((r) => r.json())
      .then((historical) => {
        if (historical?.ok && historical.data) {
          setDistinct((current) => Object.fromEntries(
            Object.keys(current).map((key) => [key, mergeOptions(current[key as keyof DistinctOptions], historical.data[key] ?? [])])
          ) as DistinctOptions);
          setLastDirectoryRefresh(new Date());
        }
      })
      .catch(() => {});

    fetch("/api/nextgen/filter-options")
      .then((r) => r.json())
      .then((nextGen) => {
        if (!nextGen?.ok) {
          setNextGenDirectoryState("unavailable");
          return;
        }
        const data = nextGen as NextGenFilterOptions;
        setDistinct((current) => ({
          yarnTypes: mergeOptions(current.yarnTypes, data.yarnTypes),
          knitTypes: mergeOptions(current.knitTypes, data.knitTypes),
          machineTypes: mergeOptions(current.machineTypes, data.machineTypes),
          constructions: mergeOptions(current.constructions, data.constructions),
          categories: mergeOptions(current.categories, data.categories),
          factories: mergeOptions(current.factories, data.factories),
          brands: mergeOptions(current.brands, data.brands),
          customers: mergeOptions(current.customers, data.customers),
          seasons: mergeOptions(current.seasons, data.seasons)
        }));
        setNextGenDirectoryState(nextGen.partial ? "partial" : "live");
        setLastDirectoryRefresh(nextGen.refreshedAt ? new Date(nextGen.refreshedAt) : new Date());
      })
      .catch(() => setNextGenDirectoryState("unavailable"));
  }, []);

  // Restore the saved comparison search on mount (hydration-safe: the initial
  // render always uses the defaults, localStorage is only read post-hydration)
  // and auto-run it once so returning users land on their results.
  useEffect(() => {
    let saved: LikeStylesFilters | null = null;
    try {
      saved = parseLikeStylesPrefs(localStorage.getItem(STORAGE_KEY));
    } catch {
      return;
    }
    if (!saved) return;
    setFilters(saved);
    if (hasLikeStylesCriteria(saved)) {
      lastSearchedRef.current = serializeLikeStylesPrefs(saved);
      runSearch(saved);
    }
  }, [runSearch]);

  // Auto-search as filters change — no "Find" click needed. Debounced so
  // typing a yarn name or picking dropdown values fires once the user pauses.
  // Skips when the filters match the last executed search (mount restore,
  // repeat picks) or when every filter is empty.
  useEffect(() => {
    if (!hasLikeStylesCriteria(filters)) return;
    const key = serializeLikeStylesPrefs(filters);
    if (key === lastSearchedRef.current) return;
    const timer = setTimeout(() => {
      lastSearchedRef.current = key;
      persistFilters(filters);
      runSearch(filters);
    }, 600);
    return () => clearTimeout(timer);
  }, [filters, runSearch]);

  const activeFilters = Object.entries(filters).filter(([key, value]) => String(value).trim() && (key !== "minScore" || Number(value) > 0));
  // The averages only cover the matched styles that actually carry the figure
  // (imported history often has no consumption / knitting time), so the card
  // states its own sample instead of implying the whole match set.
  const consumptionSample = benchmark?.consumptionSampleSize ?? results?.filter((row) => row.average_consumption != null).length ?? 0;
  const knittingSample = benchmark?.knittingSampleSize ?? results?.filter((row) => row.knitting_time != null).length ?? 0;
  // The machine table is sorted fastest first, so the first row that actually
  // carries a time is the fastest machine — cost-only machines sort last.
  const fastestMachine = benchmark?.machineSpeeds?.find((row) => row.avgKnittingTime != null) ?? null;
  function clearFilters() {
    setFilters(DEFAULT_LIKE_STYLES_FILTERS);
    lastSearchedRef.current = "";
    setResults(null);
    setBenchmark(null);
    setSearched(false);
    setLastQuery("");
    setPreviewResultId(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  }

  return (
    <section className="panel">
      <form
        className="toolbar"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}
        onSubmit={(event) => {
          lastSearchedRef.current = serializeLikeStylesPrefs(filters);
          persistFilters(filters);
          runSearch(filters, event);
        }}
      >
        <SearchableDropdown
          placeholder="Yarn type"
          value={filters.yarnType}
          options={distinct.yarnTypes}
          onChange={(v) => setField("yarnType", v)}
        />
        <SearchableDropdown
          placeholder="Knit type"
          value={filters.knitType}
          options={distinct.knitTypes}
          onChange={(v) => setField("knitType", v)}
        />
        <SearchableDropdown
          placeholder="Machine type"
          value={filters.machineType}
          options={distinct.machineTypes}
          onChange={(v) => setField("machineType", v)}
        />
        <SearchableDropdown
          placeholder="Construction"
          value={filters.construction}
          options={distinct.constructions}
          onChange={(v) => setField("construction", v)}
        />
        <SearchableDropdown
          placeholder="Category"
          value={filters.category}
          options={distinct.categories}
          onChange={(v) => setField("category", v)}
        />
        <SearchableDropdown placeholder="Factory" value={filters.factory ?? ""} options={distinct.factories} onChange={(v) => setField("factory", v)} />
        <SearchableDropdown placeholder="Brand" value={filters.brand ?? ""} options={distinct.brands} onChange={(v) => setField("brand", v)} />
        <SearchableDropdown placeholder="Customer" value={filters.customer ?? ""} options={distinct.customers} onChange={(v) => setField("customer", v)} />
        <SearchableDropdown placeholder="Season" value={filters.season ?? ""} options={distinct.seasons} onChange={(v) => setField("season", v)} />
        <SearchableDropdown
          placeholder="Notes keywords (smv, wash…)"
          value={filters.notes}
          options={[]}
          onChange={(v) => setField("notes", v)}
          freeText
        />
        <select
          className="input"
          value={filters.minScore}
          onChange={(e) => setField("minScore", Number(e.target.value))}
        >
          {MIN_SCORE_OPTIONS.map((value) => (
            <option key={value} value={value}>
              Min match: {value === 0 ? "Any" : value + "+"}
            </option>
          ))}
        </select>
        <button className="button secondary" type="submit" disabled={loading} style={{ alignSelf: "end" }}>
          {loading ? "Searching…" : "Find Like Styles"}
        </button>
        <button className="button ghost-button" type="button" onClick={clearFilters} disabled={loading || activeFilters.length === 0} style={{ alignSelf: "end" }}>
          Clear filters
        </button>
      </form>
      {activeFilters.length ? (
        <div className="active-filter-summary" aria-label="Active filters">
          <strong>Active filters</strong>
          {activeFilters.map(([key, value]) => <button key={key} type="button" className="filter-chip" onClick={() => setField(key as keyof LikeStylesFilters, key === "minScore" ? Number(value) : "")}>{key === "minScore" ? `Min score: ${value}` : `${key.replace(/([A-Z])/g, " $1")}: ${value}`} <span aria-hidden="true">×</span></button>)}
          <span className="result-count">{results ? `${results.length} result${results.length === 1 ? "" : "s"}` : "No results loaded"}</span>
        </div>
      ) : null}
      <p className={`like-styles-source ${nextGenDirectoryState}`}>
        Historical comparisons use approved Supabase costings. Filter choices also use {nextGenDirectoryState === "live" ? "live NextGen Product and PO-line data" : nextGenDirectoryState === "partial" ? "partial NextGen data (not a complete directory)" : nextGenDirectoryState === "loading" ? "NextGen data (loading…)" : "historical options while NextGen is unavailable"}. {lastDirectoryRefresh ? `Last refreshed ${lastDirectoryRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : ""}
      </p>
      {nextGenDirectoryState === "loading" && !distinct.yarnTypes.length ? <SkeletonTable rows={2} /> : null}

      {error ? <p className="notice">{error}</p> : null}

      {benchmark ? (
        <div className="metrics" style={{ margin: "12px 0" }}>
          <div className="metric">
            <span className="metric-label">Matched styles</span>
            <strong>{benchmark.sampleSize}</strong>
          </div>
          <div className="metric">
            <span className="metric-label">Avg consumption (matched)</span>
            <strong>
              {benchmark.averageConsumption != null ? benchmark.averageConsumption.toFixed(2) : "—"}
            </strong>
            {benchmark.averageConsumption != null ? (
              <small>{consumptionSample} of {benchmark.sampleSize} styles carry consumption</small>
            ) : null}
          </div>
          <div className="metric">
            <span className="metric-label">Avg knitting time (matched)</span>
            <strong>
              {benchmark.averageKnittingTime != null ? `${benchmark.averageKnittingTime.toFixed(1)} min` : "—"}
            </strong>
            {benchmark.averageKnittingTime != null ? (
              <small>{knittingSample} of {benchmark.sampleSize} styles carry knitting time</small>
            ) : null}
          </div>
          {fastestMachine ? (
            <div className="metric">
              <span className="metric-label">Fastest machine (matched)</span>
              <strong>
                {fastestMachine.machineType}
              </strong>
              <small>
                {fastestMachine.avgKnittingTime?.toFixed(1)} min avg · {fastestMachine.sampleSize}{" "}
                style{fastestMachine.sampleSize === 1 ? "" : "s"}
                {fastestMachine.avgLandedCost != null
                  ? ` · ${fastestMachine.currency} ${fastestMachine.avgLandedCost.toFixed(2)} cost`
                  : ""}
              </small>
            </div>
          ) : null}
        </div>
      ) : null}

      {benchmark?.machineSpeeds?.length ? (
        <section className="panel" style={{ margin: "0 0 12px" }}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Speed and cost from the same historical pool</p>
              <h2>Machine speed — avg knitting time</h2>
            </div>
          </div>
          <table className="table compact">
            <thead>
              <tr>
                <th>Machine type</th>
                <th>Avg knitting time</th>
                <th>Avg landed cost</th>
                <th>Avg margin</th>
                <th>Styles</th>
              </tr>
            </thead>
            <tbody>
              {benchmark.machineSpeeds.map((row) => (
                <tr key={row.machineType}>
                  <td><strong>{row.machineType}</strong></td>
                  <td>{row.avgKnittingTime != null ? `${row.avgKnittingTime.toFixed(1)} min` : "—"}</td>
                  <td>
                    {row.avgLandedCost != null ? (
                      <>
                        {row.currency} {row.avgLandedCost.toFixed(2)}
                        <small style={{ display: "block", opacity: 0.7 }}>
                          {row.costSampleSize} style{row.costSampleSize === 1 ? "" : "s"} with cost
                        </small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {row.avgMargin != null ? (
                      <>
                        {row.avgMargin >= 0 ? "+" : "−"}
                        {row.currency} {Math.abs(row.avgMargin).toFixed(2)}
                        <small style={{ display: "block", opacity: 0.7 }}>
                          {row.marginSampleSize} priced
                        </small>
                      </>
                    ) : (
                      <span title="No matched style carries a real selling price yet, so no margin can be averaged.">—</span>
                    )}
                  </td>
                  <td>{row.sampleSize}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="chart-caption">
            Cost and margin are averaged over the matched styles that carry them — never over the whole
            machine group. Cost is the landed cost where the costing recorded one, otherwise the approved
            FOB total. Margin needs a real selling price (PBD-entered or NextGen), so imported history
            without pricing shows “—”. Machines are ordered fastest first; those with no recorded speed are
            listed last.
          </p>
        </section>
      ) : null}

      {results && results.length && lastQuery ? (
        <div className="export-btn-group">
          <Link className="button secondary small-btn" href={`/api/export/like-styles.csv?${lastQuery}`}>
            Export CSV
          </Link>
          <Link className="button secondary small-btn" href={`/api/export/like-styles.xlsx?${lastQuery}`}>
            Export Excel
          </Link>
          <span className="eyebrow">Save this comparison set ({results.length} styles)</span>
        </div>
      ) : null}

      {results && results.length && !savedShareUrl ? (
        <div className="save-set-block">
          <input
            className="input"
            placeholder="Set name (e.g. Acrylic beanies — SS27 review)"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            maxLength={120}
            disabled={savingSet}
          />
          <button
            className="button secondary small-btn"
            onClick={saveSet}
            disabled={savingSet || !saveName.trim()}
          >
            {savingSet ? "Saving…" : "Save comparison set"}
          </button>
          {saveError ? <p className="action-error">{saveError}</p> : null}
        </div>
      ) : null}

      {savedShareUrl ? (
        <div className="save-set-block saved">
          <span className="status green">Saved — share this link with PBD or Costing</span>
          <div className="input-row">
            <input className="input" readOnly value={savedShareUrl} onFocus={(e) => e.target.select()} />
            <CopyShareLink url={savedShareUrl} label="Copy" />
            <Link className="button secondary small-btn" href={savedShareUrl.replace(/^https?:\/\/[^/]+/, "")}>
              Open
            </Link>
          </div>
        </div>
      ) : null}

      {searched && results !== null && !results.length ? (
        <div className="empty-state">
          <strong>No comparable styles found</strong>
          <p>Loosen the filters (lower the minimum match) or add a notes keyword to broaden the search.</p>
        </div>
      ) : null}

      {results && results.length ? (
        <>
        <p className="like-results-summary" aria-live="polite">
          Showing {resultsPage * 5 + 1}–{Math.min((resultsPage + 1) * 5, results.length)} of {results.length} comparable styles
        </p>
        <ul className="list compact-list like-styles-results">
          {results.slice(resultsPage * 5, resultsPage * 5 + 5).map((row) => (
            <li
              key={row.id}
              className="like-style-result"
              onMouseEnter={() => setPreviewResultId(row.id)}
              onMouseLeave={() => setPreviewResultId((current) => current === row.id ? null : current)}
              onFocus={() => setPreviewResultId(row.id)}
              onBlur={() => setPreviewResultId((current) => current === row.id ? null : current)}
            >
              <strong>{row.style_number ?? "No style"}</strong>
              <span className="activity-role">{row.matchScore} match ({row.scorePercent}%)</span>
              {row.confidence ? (
                <span className={`status ${row.confidence === "high" ? "green" : row.confidence === "medium" ? "amber" : "red"}`}>
                  {row.confidence === "high" ? "High" : row.confidence === "medium" ? "Medium" : "Low"} confidence
                </span>
              ) : null}
              {row.matchReasons.length ? <span className="eyebrow"> — {row.matchReasons.join(", ")}</span> : null}
              <br />
              <span className="eyebrow">Based on {row.sampleSize} historical costing{row.sampleSize === 1 ? "" : "s"} · Factory / Brand / Customer / Season are weighted in the score</span>
              <br />
              {row.factory_name ?? "Unassigned"} / {row.currency ?? "USD"} {row.total_cost?.toFixed(2) ?? "Pending"}
              {row.yarn_type || row.knit_type || row.machine_type ? (
                <>
                  <br />
                  <span className="eyebrow">
                    {[row.yarn_type, row.knit_type, row.machine_type].filter(Boolean).join(" / ")}
                  </span>
                </>
              ) : null}
              {row.average_consumption != null || row.knitting_time != null ? (
                <>
                  <br />
                  <span className="eyebrow">
                    Cons. {row.average_consumption != null ? `${row.average_consumption.toFixed(2)} kg` : "—"} · Knit{" "}
                    {row.knitting_time != null ? `${row.knitting_time.toFixed(2)} min` : "—"}
                  </span>
                </>
              ) : null}
              {row.matchingNotes.length ? (
                <div className="activity-note">
                  {row.matchingNotes.slice(0, 2).map((note, index) => (
                    <p key={index}>
                      <span className="eyebrow">
                        {note.note_type}
                        {note.tags.length ? ` · ${note.tags.join(", ")}` : ""}:
                      </span>{" "}
                      {note.note}
                    </p>
                  ))}
                </div>
              ) : null}
              <>
                <br />
                <Link className="table-action" href={`/requests/new?baseline=${encodeURIComponent(row.id)}`}>
                  Copy baseline
                </Link>
                {row.costing_request_id ? (
                  <Link className="table-action" href={`/requests/${row.costing_request_id}`}>
                    Open approved costing
                  </Link>
                ) : null}
              </>
              {previewResultId === row.id ? (
                <div className="like-style-quick-view" role="status">
                  <strong>Quick view</strong>
                  <span>Factory: {row.factory_name ?? "Unassigned"}</span>
                  <span>Brand: {row.brand ?? "Unknown"} · Customer: {row.customer ?? "Unknown"} · Season: {row.season ?? "Unknown"}</span>
                  <span>Approved cost: {row.currency ?? "USD"} {row.total_cost?.toFixed(2) ?? "—"}</span>
                  <span>Yarn: {row.yarn_type ?? "—"} · Knit: {row.knit_type ?? "—"} · Machine: {row.machine_type ?? "—"}</span>
                  <span>Construction: {row.construction ?? "—"} · Category: {row.product_category ?? "—"}</span>
                  <span>Consumption: {row.average_consumption != null ? `${row.average_consumption.toFixed(2)} kg` : "—"} · Knitting: {row.knitting_time != null ? `${row.knitting_time.toFixed(2)} min` : "—"}</span>
                </div>
              ) : null}
              <button type="button" className="quick-view-trigger" onClick={() => setPreviewResultId((current) => current === row.id ? null : row.id)} aria-expanded={previewResultId === row.id}>
                {previewResultId === row.id ? "Hide quick view" : "Quick view"}
              </button>
            </li>
          ))}
        </ul>
        {results.length > 5 ? (
          <div className="pagination-controls like-styles-pagination">
            <button className="button secondary small-btn" type="button" onClick={() => setResultsPage((page) => Math.max(0, page - 1))} disabled={resultsPage === 0}>Previous 5</button>
            <span className="eyebrow">Page {resultsPage + 1} of {Math.ceil(results.length / 5)}</span>
            <button className="button secondary small-btn" type="button" onClick={() => setResultsPage((page) => Math.min(Math.ceil(results.length / 5) - 1, page + 1))} disabled={(resultsPage + 1) * 5 >= results.length}>Next 5</button>
          </div>
        ) : null}
        </>
      ) : null}
    </section>
  );
}

function SearchableDropdown({
  placeholder,
  value,
  options,
  onChange,
  freeText = false,
}: {
  placeholder: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  freeText?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const listId = `like-dd-${placeholder.replace(/\s+/g, "-").toLowerCase()}`;

  // Keep query in sync when parent value changes (e.g., restore from storage)
  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options.slice(0, 30);
    return options.filter((o) => o.toLowerCase().includes(needle)).slice(0, 30);
  }, [options, query]);

  const showMenu = open && (filtered.length > 0 || freeText);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 4 }}>
        <input
          className="input"
          placeholder={`${placeholder}${options.length ? ` (${options.length})` : ""} — type to search`}
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            onChange(v);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
        />
        {value ? (
          <button
            type="button"
            className="button secondary small-btn"
            style={{ padding: "0 8px", minHeight: 36 }}
            onClick={() => {
              setQuery("");
              onChange("");
              setOpen(false);
            }}
            title="Clear"
          >
            ×
          </button>
        ) : null}
      </div>
      {showMenu ? (
        <div
          id={listId}
          className="searchable-filter-menu"
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 20,
            marginTop: 4,
            maxHeight: 220,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid var(--line)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          {filtered.length ? (
            filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={opt === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQuery(opt);
                  onChange(opt);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  border: 0,
                  borderBottom: "1px solid var(--line)",
                  background: opt === value ? "var(--brand-soft)" : "#fff",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {opt}
              </button>
            ))
          ) : freeText ? (
            <div style={{ padding: "8px 10px", fontSize: 13, color: "var(--muted)" }}>No matches — press Enter to search “{query}”</div>
          ) : (
            <div style={{ padding: "8px 10px", fontSize: 13, color: "var(--muted)" }}>No matches</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
