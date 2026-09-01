"use client";

import type { MasterBenchmarkFlag, MasterBenchmarkLine } from "@/lib/costing/master-benchmark";

/**
 * Master material benchmark — semi-automation for MD review. Shows which
 * material / operation / knitting lines of the submitted CBD sit materially
 * above the master list averages, so MD can pass or clarify with data.
 */
export function MasterBenchmarkPanel({
  flags,
  benchmark,
  error
}: {
  flags: MasterBenchmarkFlag[];
  benchmark: MasterBenchmarkLine[];
  error?: string | null;
}) {
  if (error) {
    return (
      <section className="panel">
        <p className="eyebrow">Semi-automated MD reference</p>
        <h2>Master Material Benchmark</h2>
        <p className="notice">Benchmark unavailable: {error}</p>
      </section>
    );
  }

  if (!benchmark.length && !flags.length) {
    return (
      <section className="panel">
        <p className="eyebrow">Semi-automated MD reference</p>
        <h2>Master Material Benchmark</h2>
        <p className="notice">Not enough submitted CBD data yet to build a master benchmark.</p>
      </section>
    );
  }

  const categoryLabel = (category: MasterBenchmarkLine["category"]) =>
    category === "material" ? "Material" : category === "operation" ? "Operation" : "Knitting";

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Semi-automated MD reference</p>
          <h2>Master Material Benchmark</h2>
        </div>
        <span className={`status ${flags.length ? "amber" : "green"}`}>
          {flags.length ? `${flags.length} flag(s)` : "Within range"}
        </span>
      </div>
      <p className="eyebrow">
        Lines {'>'}30% above the master-list average are flagged for the MD technical review. These are references, not gates.
      </p>

      {flags.length ? (
        <>
          <h3 style={{ marginTop: 12 }}>Flagged Lines</h3>
          <table className="table compact">
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th>This CBD</th>
                <th>Master Avg</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((flag, index) => (
                <tr key={`${flag.line.category}-${flag.line.label}-${index}`}>
                  <td>{categoryLabel(flag.line.category)}</td>
                  <td>
                    <strong>{flag.line.label}</strong>
                    {flag.line.isCurated ? <span className="status violet" style={{ marginLeft: 6 }}>curated</span> : null}
                  </td>
                  <td>{flag.actual.toFixed(2)}{flag.line.isTime ? " min" : ""}</td>
                  <td>{flag.line.average?.toFixed(2)}{flag.line.isTime ? " min" : ""}</td>
                  <td><span className="status red">+{flag.variancePercent.toFixed(0)}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="notice">No material, operation, or knitting line is materially above the master benchmark. Good for MD pass.</p>
      )}

      {benchmark.length ? (
        <>
          <h3 style={{ marginTop: 16 }}>Top Master References ({benchmark.length})</h3>
          <table className="table compact">
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th>Avg</th>
                <th>Median</th>
                <th>Max</th>
                <th>Samples</th>
              </tr>
            </thead>
            <tbody>
              {benchmark.slice(0, 15).map((line, index) => (
                <tr key={`${line.category}-${line.label}-${index}`}>
                  <td>{categoryLabel(line.category)}</td>
                  <td>
                    <strong>{line.label}</strong>
                    {line.isCurated ? <span className="status violet" style={{ marginLeft: 6 }}>curated</span> : null}
                  </td>
                  <td>{line.average?.toFixed(2)}{line.isTime ? " min" : ""}</td>
                  <td>{line.median?.toFixed(2)}{line.isTime ? " min" : ""}</td>
                  <td>{line.max?.toFixed(2)}{line.isTime ? " min" : ""}</td>
                  <td>{line.sampleSize}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
