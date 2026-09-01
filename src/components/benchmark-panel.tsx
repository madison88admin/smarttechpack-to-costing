import type { AttributeBenchmark, BenchmarkSummary } from "@/lib/costing/history";

export function BenchmarkPanel({
  benchmark,
  attributeBenchmark,
  currentConsumption,
  currentKnittingTime,
  error,
  warningVariancePercent = 15,
  reviewVariancePercent = 8
}: {
  benchmark?: BenchmarkSummary | null;
  attributeBenchmark?: AttributeBenchmark | null;
  currentConsumption?: number | null;
  currentKnittingTime?: number | null;
  error?: string | null;
  warningVariancePercent?: number;
  reviewVariancePercent?: number;
}) {
  if (error) {
    return (
      <section className="panel">
        <h2>Benchmark</h2>
        <p className="notice">Benchmark unavailable: {error}</p>
      </section>
    );
  }

  if (!benchmark && !attributeBenchmark) {
    return null;
  }

  const tone = getVarianceTone(benchmark?.variancePercent ?? null, warningVariancePercent, reviewVariancePercent);
  const consumptionVariance = computeVariance(currentConsumption, attributeBenchmark?.averageConsumption ?? null);
  const knittingVariance = computeVariance(currentKnittingTime, attributeBenchmark?.averageKnittingTime ?? null);

  return (
    <section className="panel">
      <h2>Benchmark</h2>
      {benchmark ? (
        <>
          <h3 className="eyebrow">Cost Benchmark</h3>
          <div className="benchmark-grid">
            <div>
              <span>Current CBD</span>
              <strong>
                {benchmark.currency} {formatCost(benchmark.currentTotal)}
              </strong>
            </div>
            <div>
              <span>Historical Avg</span>
              <strong>
                {benchmark.currency} {formatCost(benchmark.historicalAverage)}
              </strong>
            </div>
            <div>
              <span>Variance</span>
              <strong className={tone}>{formatVariance(benchmark.variancePercent)}</strong>
            </div>
            <div>
              <span>Samples</span>
              <strong>{benchmark.sampleSize}</strong>
            </div>
          </div>

          {benchmark.currencyConverted ? (
            <p className="notice" style={{ marginTop: 8 }}>
              <strong>Currency converted:</strong> {benchmark.convertedCount} historical record(s) converted
              from {benchmark.convertedFrom.join(", ")} to {benchmark.currency} for comparison.
            </p>
          ) : null}

          {benchmark.matches.length ? (
            <ul className="list compact-list">
              {benchmark.matches.map((match) => (
                <li key={match.id}>
                  <strong>{match.style_number ?? "No style"}</strong>
                  <br />
                  {match.factory_name ?? "Unassigned"} / {match.currency ?? benchmark.currency}{" "}
                  {formatCost(match.total_cost)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="eyebrow">No approved historical matches yet.</p>
          )}
        </>
      ) : null}

      {attributeBenchmark && attributeBenchmark.sampleSize > 0 ? (
        <div style={{ marginTop: 16 }}>
          <h3 className="eyebrow">Attribute Benchmark (Yarn / Knit / Machine)</h3>
          <div className="benchmark-grid">
            <div>
              <span>Avg Consumption</span>
              <strong>{formatMetric(attributeBenchmark.averageConsumption)}</strong>
            </div>
            <div>
              <span>Current Consumption</span>
              <strong>{formatMetric(currentConsumption)}</strong>
            </div>
            <div>
              <span>Consumption Var</span>
              <strong className={getVarianceTone(consumptionVariance, warningVariancePercent, reviewVariancePercent)}>{formatVariance(consumptionVariance)}</strong>
            </div>
            <div>
              <span>Attr Samples</span>
              <strong>{attributeBenchmark.sampleSize}</strong>
            </div>
            <div>
              <span>Avg Knitting Time</span>
              <strong>{formatMetric(attributeBenchmark.averageKnittingTime)}</strong>
            </div>
            <div>
              <span>Current Knitting</span>
              <strong>{formatMetric(currentKnittingTime)}</strong>
            </div>
            <div>
              <span>Knitting Var</span>
              <strong className={getVarianceTone(knittingVariance, warningVariancePercent, reviewVariancePercent)}>{formatVariance(knittingVariance)}</strong>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function computeVariance(current: number | null | undefined, historical: number | null | undefined) {
  if (typeof current !== "number" || typeof historical !== "number" || historical <= 0) return null;
  return ((current - historical) / historical) * 100;
}

function formatMetric(value: number | null | undefined) {
  if (value === null || value === undefined) return "N/A";
  return value.toFixed(3);
}

function formatCost(value: number | null) {
  if (value === null) return "Pending";
  return value.toFixed(2);
}

function formatVariance(value: number | null) {
  if (value === null) return "Pending";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function getVarianceTone(value: number | null, warning: number, review: number) {
  if (value === null) return "";
  if (Math.abs(value) >= warning) return "text-red";
  if (Math.abs(value) >= review) return "text-amber";
  return "text-green";
}
