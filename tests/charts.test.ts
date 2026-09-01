import { describe, expect, it } from "vitest";
import { barGeometry, lineGeometry, sparklineGeometry } from "../src/components/charts";

describe("barGeometry", () => {
  it("scales bar widths proportionally to the largest value", () => {
    const geo = barGeometry(
      [
        { label: "Draft", value: 2 },
        { label: "Approved", value: 4 }
      ],
      { width: 400, labelWidth: 100 }
    );
    expect(geo.max).toBe(4);
    expect(geo.height).toBe(2 * 26 + 6);
    const draft = geo.rows.find((row) => row.label === "Draft")!;
    const approved = geo.rows.find((row) => row.label === "Approved")!;
    expect(draft.barWidth).toBe(Math.round(approved.barWidth / 2));
    expect(draft.valueX).toBeGreaterThan(draft.barWidth);
  });

  it("clamps the sub bar to the main bar width and skips zero subs", () => {
    const geo = barGeometry([
      { label: "A", value: 10, sub: 3 },
      { label: "B", value: 10, sub: 12 },
      { label: "C", value: 10, sub: 0 }
    ]);
    const a = geo.rows[0];
    const b = geo.rows[1];
    const c = geo.rows[2];
    expect(a.subWidth).toBeLessThan(a.barWidth);
    expect(a.subValueX).not.toBeNull();
    // sub > value is clamped to the full bar and its label is suppressed
    expect(b.subWidth).toBe(b.barWidth);
    expect(b.subValueX).toBeNull();
    expect(c.sub).toBeNull();
    expect(c.subWidth).toBeNull();
  });

  it("handles empty input and zero values without dividing by zero", () => {
    const empty = barGeometry([]);
    expect(empty.max).toBe(1);
    expect(empty.rows).toHaveLength(0);

    const zeros = barGeometry([{ label: "A", value: 0 }]);
    expect(zeros.max).toBe(1);
    expect(zeros.rows[0].barWidth).toBe(0);
  });

  it("honors an explicit max", () => {
    const geo = barGeometry([{ label: "A", value: 3 }], { max: 10 });
    expect(geo.max).toBe(10);
  });
});

describe("lineGeometry", () => {
  const series = [
    { name: "Created", color: "var(--blue)", points: [{ label: "2026-01", value: 0 }, { label: "2026-02", value: 10 }] },
    { name: "Approved", color: "var(--green)", points: [{ label: "2026-01", value: 2 }, { label: "2026-02", value: 8 }] }
  ];

  it("maps the largest value to the top of the plot area", () => {
    const geo = lineGeometry(series, { width: 480, height: 180 });
    expect(geo.max).toBe(10);
    const created = geo.series[0].points;
    // value 0 sits at the bottom, value 10 at the top
    expect(created[0].y).toBeGreaterThan(created[1].y);
    // both series share the same x positions
    expect(geo.series[1].points[0].x).toBe(created[0].x);
    // x increases left to right
    expect(created[1].x).toBeGreaterThan(created[0].x);
  });

  it("emits a grid with the max at the top", () => {
    const geo = lineGeometry(series, { height: 180 });
    expect(geo.grid).toHaveLength(5);
    const [bottom, , , , top] = geo.grid;
    expect(bottom.value).toBe(0);
    expect(top.value).toBe(10);
    expect(bottom.y).toBeGreaterThan(top.y);
  });

  it("handles a single point and empty series", () => {
    const single = lineGeometry([{ name: "S", color: "var(--blue)", points: [{ label: "2026-01", value: 5 }] }]);
    expect(single.xs).toHaveLength(1);
    expect(single.series[0].points[0].x).toBe(single.padX);

    const empty = lineGeometry([]);
    expect(empty.max).toBe(1);
    expect(empty.series).toHaveLength(0);
  });
});

describe("lineGeometry — dual axis", () => {
  it("computes separate left and right scales", () => {
    // Left series: 0–10; right series: 0–100
    const geo = lineGeometry([
      { name: "Left", color: "var(--blue)", points: [{ label: "Jan", value: 0 }, { label: "Feb", value: 10 }] },
      { name: "Right", color: "var(--amber)", axis: "right", points: [{ label: "Jan", value: 0 }, { label: "Feb", value: 100 }] }
    ], { width: 480, height: 180 });

    expect(geo.max).toBe(10);       // left max
    expect(geo.rightMax).toBe(100); // right max
    expect(geo.rightGrid).toHaveLength(5);

    // Left series: value 0 sits at the bottom, value 10 at the top
    const left = geo.series[0].points;
    expect(left[0].y).toBeGreaterThan(left[1].y);

    // Right series: value 0 sits at the bottom, value 100 at the top
    const right = geo.series[1].points;
    expect(right[0].y).toBeGreaterThan(right[1].y);

    // Both series use the same x positions
    expect(right[0].x).toBe(left[0].x);
  });

  it("uses the left scale when no right-axis series exist", () => {
    const geo = lineGeometry([
      { name: "A", color: "var(--blue)", points: [{ label: "Jan", value: 5 }] }
    ]);
    expect(geo.rightMax).toBeNull();
    expect(geo.rightGrid).toHaveLength(0);
  });

  it("right grid values reflect the right axis max", () => {
    const geo = lineGeometry([
      { name: "Created", color: "var(--blue)", points: [{ label: "Jan", value: 0 }, { label: "Feb", value: 50 }] },
      { name: "Cost", color: "var(--amber)", axis: "right", points: [{ label: "Jan", value: 0 }, { label: "Feb", value: 8 }] }
    ], { height: 200 });

    const [bottom, , , , top] = geo.rightGrid;
    expect(bottom.value).toBe(0);
    expect(top.value).toBe(8);
    expect(top.y).toBeLessThan(bottom.y);
  });

  it("honors an explicit rightMax", () => {
    const geo = lineGeometry([
      { name: "Right", color: "var(--amber)", axis: "right", points: [{ label: "Jan", value: 3 }] }
    ], { rightMax: 10 });
    expect(geo.rightMax).toBe(10);
  });
});

describe("sparklineGeometry", () => {
  it("maps larger values to the top (smaller y) with even spacing", () => {
    const geo = sparklineGeometry([2, 4, 8, 16], { width: 100, height: 30 });
    expect(geo.min).toBe(2);
    expect(geo.max).toBe(16);
    expect(geo.points).toHaveLength(4);
    // x advances left to right
    expect(geo.points[1].x).toBeGreaterThan(geo.points[0].x);
    expect(geo.points[3].x).toBeGreaterThan(geo.points[2].x);
    // highest value sits at the top
    expect(geo.points[3].y).toBeLessThan(geo.points[0].y);
    // path carries the same coordinates as the points
    expect(geo.path).toBe(geo.points.map((p) => `${p.x},${p.y}`).join(" "));
    expect(geo.areaPath).toContain("L");
  });

  it("skips non-finite values", () => {
    const geo = sparklineGeometry([1, Number.NaN, 3, Infinity, 5]);
    expect(geo.points).toHaveLength(3);
  });

  it("returns an empty geometry for no usable values", () => {
    const geo = sparklineGeometry([]);
    expect(geo.points).toHaveLength(0);
    expect(geo.path).toBe("");
    expect(geo.areaPath).toBeNull();
    const dirty = sparklineGeometry([Number.NaN]);
    expect(dirty.points).toHaveLength(0);
  });

  it("centers a single value and omits the area fill", () => {
    const geo = sparklineGeometry([5], { width: 100, height: 30 });
    expect(geo.points).toHaveLength(1);
    expect(geo.points[0].x).toBeCloseTo(50, 0); // padded horizontal center
    expect(geo.areaPath).toBeNull();
  });

  it("renders a flat series as a mid-height line without an area fill", () => {
    const geo = sparklineGeometry([7, 7, 7, 7], { height: 30 });
    const ys = geo.points.map((point) => point.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(0);
    expect(ys[0]).toBe(15); // vertical midline of the 30px plot
    expect(geo.areaPath).toBeNull();
  });
});
