// Dependency-free SVG charts for the Reports dashboard.
//
// The geometry is computed by pure helpers (barGeometry / lineGeometry) that
// are exported so they can be unit-tested in the node test environment without
// a DOM. The components are thin, server-safe SVG renderers (no hooks, no
// client directives) so they also render correctly in print / PDF export.

export type BarItem = {
  label: string;
  value: number;
  /** Optional second series (e.g. approved count) drawn as a green segment. */
  sub?: number;
  /** Optional raw key (e.g. status code) used by the rowHref builder. */
  key?: string;
  /** Optional per-row bar color (e.g. a stage color). Defaults to the theme bar color. */
  color?: string;
};

export type BarRowGeometry = {
  label: string;
  y: number;
  barWidth: number;
  subWidth: number | null;
  valueX: number;
  subValueX: number | null;
  value: number;
  sub: number | null;
};

export type BarGeometry = {
  width: number;
  height: number;
  max: number;
  barX: number;
  rows: BarRowGeometry[];
};

export type BarGeometryOptions = {
  width?: number;
  rowHeight?: number;
  labelWidth?: number;
  /** Explicit scale max (defaults to the largest value across both series). */
  max?: number;
};

export function barGeometry(items: BarItem[], opts: BarGeometryOptions = {}): BarGeometry {
  const width = opts.width ?? 480;
  const rowHeight = opts.rowHeight ?? 26;
  const labelWidth = opts.labelWidth ?? 160;
  const max =
    opts.max ??
    Math.max(
      1,
      ...items.flatMap((item) => [item.value, item.sub ?? 0])
    );
  const barX = labelWidth + 10;
  const barMaxWidth = width - barX - 80; // leave room for value labels + share %
  const scale = barMaxWidth / Math.max(1, max);
  const height = Math.max(1, items.length) * rowHeight + 6;

  const rows = items.map((item, index) => {
    const y = index * rowHeight + 3;
    const barWidth = Math.round(item.value * scale);
    const sub = item.sub !== undefined && item.sub > 0 ? item.sub : null;
    const subWidth = sub !== null ? Math.min(Math.round(sub * scale), barWidth) : null;
    return {
      label: item.label,
      y,
      barWidth,
      subWidth,
      valueX: barX + barWidth + 6,
      subValueX: sub !== null && sub < item.value ? barX + subWidth! + 6 : null,
      value: item.value,
      sub
    };
  });

  return { width, height, max, barX, rows };
}

export type LinePoint = { label: string; value: number };
export type LineSeries = {
  name: string;
  color: string;
  points: LinePoint[];
  /** Plots against the right-hand axis (own scale). Defaults to the left axis. */
  axis?: "left" | "right";
  /** Uses a dashed stroke for projections or other indicative series. */
  dash?: boolean;
};

export type LineGeometryOptions = {
  width?: number;
  height?: number;
  /** Explicit left-axis scale max (defaults to the largest left-axis value). */
  max?: number;
  /** Explicit right-axis scale max (defaults to the largest right-axis value). */
  rightMax?: number;
};

export type LineGeometry = {
  width: number;
  height: number;
  max: number;
  rightMax: number | null;
  padX: number;
  rightPadX: number;
  xs: number[];
  grid: Array<{ value: number; y: number }>;
  rightGrid: Array<{ value: number; y: number }>;
  series: Array<{
    name: string;
    color: string;
    dash?: boolean;
    points: Array<{ x: number; y: number; label: string; value: number }>;
  }>;
};

export function lineGeometry(series: LineSeries[], opts: LineGeometryOptions = {}): LineGeometry {
  const width = opts.width ?? 480;
  const height = opts.height ?? 180;
  const padX = 34; // room for the left y-axis max label
  const rightPadX = 36; // room for the right y-axis max label
  const padBottom = 24; // room for category labels

  const leftSeries = series.filter((item) => item.axis !== "right");
  const rightSeries = series.filter((item) => item.axis === "right");
  const hasRightAxis = rightSeries.length > 0;
  const rightPad = hasRightAxis ? rightPadX : 0;

  const max = opts.max ?? Math.max(1, ...leftSeries.flatMap((item) => item.points.map((point) => point.value)));
  const rightMax =
    hasRightAxis
      ? opts.rightMax ?? Math.max(1, ...rightSeries.flatMap((item) => item.points.map((point) => point.value)))
      : null;

  const categoryCount = Math.max(1, series[0]?.points.length ?? 1);
  const plotRight = width - rightPad - 10;
  const stepX = categoryCount > 1 ? (plotRight - padX) / (categoryCount - 1) : plotRight - padX;
  const xs = series[0]?.points.map((_, index) => Math.round(padX + index * stepX)) ?? [];
  const plotHeight = height - padBottom - 10;
  const scale = plotHeight / max;
  const rightScale = hasRightAxis ? plotHeight / rightMax! : scale;

  const gridCount = 4;
  const grid = Array.from({ length: gridCount + 1 }, (_, index) => {
    const value = Math.round((index / gridCount) * max * 10) / 10;
    return { value, y: Math.round(height - padBottom - value * scale) };
  });
  const rightGrid = hasRightAxis
    ? Array.from({ length: gridCount + 1 }, (_, index) => {
        const value = Math.round((index / gridCount) * rightMax! * 10) / 10;
        return { value, y: Math.round(height - padBottom - value * rightScale) };
      })
    : [];

  const mapped = series.map((item) => {
    const itemScale = item.axis === "right" ? rightScale : scale;
    return {
      name: item.name,
      color: item.color,
      dash: item.dash,
      points: item.points.map((point, index) => ({
        x: xs[index] ?? padX,
        y: Math.round(height - padBottom - point.value * itemScale),
        label: point.label,
        value: point.value
      }))
    };
  });

  return { width, height, max, rightMax, padX, rightPadX, xs, grid, rightGrid, series: mapped };
}

/**
 * Horizontal bar chart. When any item has a `sub` value, the main bar renders
 * as a muted track with a green segment for the sub series (e.g. approved
 * portion of requests) and an HTML legend is shown.
 */
export function HBarChart({ items, mainLabel = "Requests", subLabel = "Approved", rowHref, showShare = false }: {
  items: BarItem[];
  mainLabel?: string;
  subLabel?: string;
  /** When provided, each row renders as a link drilling into a filtered view. */
  rowHref?: (item: BarItem) => string;
  /** Shows each value's share of the total next to the count (count charts only —
   *  never enable on cost charts, where a cost share would be misleading). */
  showShare?: boolean;
}) {
  if (!items.length) return <p className="eyebrow">No data to chart.</p>;
  const hasSub = items.some((item) => (item.sub ?? 0) > 0);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  // Give category charts a more legible rhythm than the compact geometry
  // helper default. This keeps labels and bars readable in report cards.
  const geo = barGeometry(items, { rowHeight: 32 });

  const renderRow = (row: BarRowGeometry, index: number) => {
    const item = items[index];
    const displayLabel = row.label.length > 24 ? `${row.label.slice(0, 21)}...` : row.label;
    const content = (
      <>
        <text x={0} y={row.y + 16} className="chart-label">
          {displayLabel}
          <title>{row.label}</title>
        </text>
        <rect
          x={geo.barX}
          y={row.y}
          width={row.barWidth}
          height={18}
          rx={3}
          className={hasSub ? "chart-bar chart-bar-track" : "chart-bar chart-bar-solid"}
          style={item.color && !hasSub ? { fill: item.color } : undefined}
        >
          <title>{`${row.label}: ${row.value}${showShare && total > 1 ? ` (${Math.round((row.value / total) * 100)}% of total)` : ""}`}</title>
        </rect>
        {hasSub && row.sub !== null && row.subWidth !== null ? (
          <rect
            x={geo.barX}
            y={row.y}
            width={row.subWidth}
            height={18}
            rx={3}
            className="chart-bar chart-bar-sub"
          >
            <title>{`${row.label}: ${row.sub} ${subLabel.toLowerCase()}`}</title>
          </rect>
        ) : null}
        <text x={row.valueX} y={row.y + 15} className="chart-value">
          {row.value}
          {showShare && total > 1 ? (
            <tspan className="chart-value-pct" dx={5}>
              · {Math.round((row.value / total) * 100)}%
            </tspan>
          ) : null}
        </text>
        {row.subValueX !== null && row.sub !== null ? (
          <text x={row.subValueX} y={row.y + 15} className="chart-value chart-value-sub">
            {row.sub}
          </text>
        ) : null}
      </>
    );

    const href = rowHref ? rowHref(item) : null;
    return href ? (
      <a key={row.label} href={href} className="chart-row-link" aria-label={`Drill into ${row.label}`}>
        {content}
      </a>
    ) : (
      <g key={row.label}>{content}</g>
    );
  };

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${geo.width} ${geo.height}`}
        role="img"
        aria-label={`${mainLabel}${hasSub ? ` and ${subLabel}` : ""} by category`}
        className="chart-svg"
      >
        {geo.rows.map(renderRow)}
      </svg>
      {hasSub ? (
        <div className="legend">
          <span className="legend-item">
            <span className="legend-dot" style={{ background: "var(--panel-soft)", border: "1px solid var(--line)" }} />
            {mainLabel}
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: "var(--green)" }} />
            {subLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Multi-series line chart with dots and a y-axis grid. Category labels are
 * thinned when there are many of them so they do not crowd.
 */
export function LineChart({ series, height = 190 }: { series: LineSeries[]; height?: number }) {
  if (!series.length || series.every((item) => !item.points.length)) {
    return <p className="eyebrow">No data to chart.</p>;
  }
  const geo = lineGeometry(series, { height });
  const labelEvery = Math.max(1, Math.ceil(geo.xs.length / 8));

  // A single observed period is a snapshot, not a trend. Rendering the full
  // grid in that case creates a large empty chart with one dot at the edge.
  if (geo.xs.length === 1) {
    return (
      <div className="chart chart-single-point" role="img" aria-label={`${series.map((item) => item.name).join(", ")} snapshot`}>
        <div className="chart-single-point-period">{series[0]?.points[0]?.label ?? "Current period"}</div>
        <div className="chart-single-point-values">
          {series.map((item) => (
            <div key={item.name} className="chart-single-point-value">
              <span className="legend-dot" style={{ background: item.color }} />
              <strong>{item.points[0]?.value ?? 0}</strong>
              <span>{item.name}</span>
            </div>
          ))}
        </div>
        <div className="legend">
          {series.map((item) => (
            <span key={item.name} className="legend-item">
              <span className="legend-dot" style={{ background: item.color }} />
              {item.name}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${geo.width} ${geo.height}`}
        role="img"
        aria-label={`${series.map((item) => item.name).join(", ")} chart`}
        className="chart-svg"
      >
        {geo.grid.map((line) => (
          <g key={`l-${line.value}`}>
            <line
              x1={geo.padX}
              x2={geo.width - (geo.rightGrid.length ? geo.rightPadX : 10)}
              y1={line.y}
              y2={line.y}
              className="chart-grid"
            />
            <text x={geo.padX - 6} y={line.y + 3} textAnchor="end" className="chart-label">
              {line.value}
            </text>
          </g>
        ))}
        {geo.rightGrid.map((line) => (
          <g key={`r-${line.value}`}>
            <line
              x1={geo.padX}
              x2={geo.width - geo.rightPadX - 4}
              y1={line.y}
              y2={line.y}
              className="chart-grid chart-grid-right"
            />
            <text x={geo.width - geo.rightPadX + 2} y={line.y + 3} textAnchor="start" className="chart-label">
              {line.value}
            </text>
          </g>
        ))}
        {geo.series.map((item) => (
          <g key={item.name}>
            {item.dash ? null : (
              <path
                d={`M ${item.points.map((point) => `${point.x},${point.y}`).join(" L ")} L ${item.points.at(-1)?.x},${geo.height - 24} L ${item.points[0]?.x},${geo.height - 24} Z`}
                style={{ fill: item.color }}
                opacity={0.08}
              />
            )}
            <polyline
              points={item.points.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeDasharray={item.dash ? "5 4" : undefined}
              style={{ stroke: item.color }}
              className="chart-line"
            />
            {item.points.map((point, index) => (
              <circle key={index} cx={point.x} cy={point.y} r={3.5} style={{ fill: item.color }}>
                <title>{`${point.label}: ${point.value}`}</title>
              </circle>
            ))}
          </g>
        ))}
        {geo.xs.map((x, index) =>
          index % labelEvery === 0 ? (
            <text key={index} x={x} y={geo.height - 6} textAnchor="middle" className="chart-label">
              {geo.series[0]?.points[index]?.label ?? ""}
            </text>
          ) : null
        )}
      </svg>          <div className="legend">
        {series.map((item) => (
          <span key={item.name} className="legend-item">
            <span className="legend-dot" style={{ background: item.color }} />
            {item.name}
            {item.axis === "right" ? <small className="legend-axis">(right axis)</small> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

export type SparklineGeometry = {
  width: number;
  height: number;
  /** Rendered points in SVG coordinates (y is inverted). */
  points: Array<{ x: number; y: number }>;
  /** Space-separated `x,y` pairs for the <polyline>. */
  path: string;
  /** Closed fill path under the line; null for a single point. */
  areaPath: string | null;
  min: number;
  max: number;
};

export type SparklineGeometryOptions = {
  width?: number;
  height?: number;
};

/**
 * Miniature trend line used inside metric cards. Non-finite values are
 * skipped; a single value renders as a centered dot; a flat series renders as
 * a horizontal mid-line so the shape never collapses to zero height.
 */
export function sparklineGeometry(values: number[], opts: SparklineGeometryOptions = {}): SparklineGeometry {
  const width = opts.width ?? 112;
  const height = opts.height ?? 30;
  const padX = 2;
  const padY = 3;
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) {
    return { width, height, points: [], path: "", areaPath: null, min: 0, max: 1 };
  }
  const min = Math.min(...filtered);
  const max = Math.max(...filtered);
  const span = max - min;
  const scale = span > 0 ? (height - padY * 2) / span : 0;
  const stepX = filtered.length > 1 ? (width - padX * 2) / (filtered.length - 1) : 0;
  const points = filtered.map((value, index) => ({
    // A single value sits at the horizontal center of the plot.
    x: Math.round((filtered.length > 1 ? padX + index * stepX : padX + (width - padX * 2) / 2) * 100) / 100,
    // A flat series sits on the vertical midline so it reads as "steady"
    // rather than as a value at the bottom edge of the plot.
    y: Math.round((span > 0 ? height - padY - (value - min) * scale : height / 2) * 100) / 100
  }));
  const path = points.map((point) => `${point.x},${point.y}`).join(" ");
  // Area fill only when the line has real vertical movement; a flat or single
  // point would otherwise fill a misleading wedge below the midline.
  const areaPath = points.length > 1 && span > 0
    ? `M ${points.map((point) => `${point.x},${point.y}`).join(" L ")} L ${points.at(-1)?.x},${height - padY} L ${points[0]?.x},${height - padY} Z`
    : null;
  return { width, height, points, path, areaPath, min, max };
}

/** Small dependency-free trend sparkline for metric cards (server-safe SVG). */
export function Sparkline({ values, color = "var(--green)", ariaLabel }: {
  values: number[];
  color?: string;
  ariaLabel?: string;
}) {
  const geo = sparklineGeometry(values);
  if (!geo.points.length) return null;
  const last = geo.points.at(-1)!;
  return (
    <svg
      viewBox={`0 0 ${geo.width} ${geo.height}`}
      role="img"
      aria-label={ariaLabel ?? "Trend over time"}
      className="metric-spark"
      preserveAspectRatio="none"
    >
      {geo.areaPath ? (
        <path d={geo.areaPath} style={{ fill: color }} opacity={0.12} />
      ) : null}
      <polyline
        points={geo.path}
        fill="none"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ stroke: color }}
      />
      <circle cx={last.x} cy={last.y} r={2.5} style={{ fill: color }} />
    </svg>
  );
}
