import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import {
  barChartXml,
  lineChartXml,
  drawingXml,
  drawingRelsXml,
  type NativeChartSpec
} from "../src/lib/export/chart-parts";
import { injectNativeCharts } from "../src/lib/export/inject-charts";

const barSpec: NativeChartSpec = {
  sheetName: "By Status",
  title: "Pipeline by Status",
  kind: "bar",
  categories: ["Draft", "Approved"],
  series: [{ name: "Requests", values: [12, 4] }]
};

describe("chart-parts XML builders", () => {
  it("emits a horizontal clustered bar chart with series and categories", () => {
    const xml = barChartXml(barSpec);
    expect(xml).toContain('<c:barDir val="bar"/>');
    expect(xml).toContain('<c:grouping val="clustered"/>');
    expect(xml).toContain("<c:v>Draft</c:v>");
    expect(xml).toContain("<c:v>Requests</c:v>");
    expect(xml).toContain("'By Status'!$B$2:$B$3");
    expect(xml).toContain('<c:axPos val="l"/>'); // categories on the left
    expect(xml).toContain('<c:axPos val="b"/>'); // values along the bottom
  });

  it("escapes titles and category values", () => {
    const xml = barChartXml({
      ...barSpec,
      title: "Mens & Kids <Q1>",
      categories: ["A & B", "C"]
    });
    expect(xml).toContain("Mens &amp; Kids &lt;Q1&gt;");
    expect(xml).toContain("A &amp; B");
  });

  it("emits a dual-axis combo line chart when a series uses the right axis", () => {
    const xml = lineChartXml({
      sheetName: "Trend",
      title: "Monthly Trend",
      kind: "line",
      categories: ["2026-07", "2026-08"],
      series: [
        { name: "Created", values: [10, 20] },
        { name: "Approved", values: [2, 5] },
        { name: "Avg Cost", values: [7, 9], axis: "right" }
      ]
    });
    expect(xml.match(/<c:lineChart>/g)).toHaveLength(2);
    expect(xml).toContain('<c:axPos val="r"/>');
    expect(xml).toContain("<c:v>Avg Cost</c:v>");
    expect(xml).toContain("'Trend'!$D$2:$D$3");
    expect(xml).toContain('<c:axId val="3"/>');
  });

  it("emits a single-axis line chart when there is no right-axis series", () => {
    const xml = lineChartXml({
      sheetName: "Trend",
      title: "Monthly Trend",
      kind: "line",
      categories: ["2026-07"],
      series: [{ name: "Created", values: [10] }]
    });
    expect(xml.match(/<c:lineChart>/g)).toHaveLength(1);
    expect(xml).not.toContain('<c:axPos val="r"/>');
    expect(xml).not.toContain('<c:axId val="3"/>');
  });

  it("anchors a chart on a sheet via the drawing part", () => {
    const xml = drawingXml("rId1", "Pipeline by Status");
    expect(xml).toContain('name="Pipeline by Status"');
    expect(xml).toContain('r:id="rId1"');
    expect(xml).toContain("<xdr:twoCellAnchor");
  });

  it("points the drawing rels at the chart part", () => {
    const xml = drawingRelsXml("chart3.xml");
    expect(xml).toContain('Target="../charts/chart3.xml"');
    expect(xml).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart"');
  });
});

describe("injectNativeCharts", () => {
  function buildWorkbook(): Buffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Status", "Requests"],
        ["Draft", 12],
        ["Approved", 4]
      ]),
      "By Status"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Bucket", "Created", "Approved", "Avg Cost"],
        ["2026-08", 51, 5, 8]
      ]),
      "Trend"
    );
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  it("injects chart + drawing parts and wires all relationships", async () => {
    const out = await injectNativeCharts(buildWorkbook(), [
      { sheetName: "By Status", spec: barSpec },
      {
        sheetName: "Trend",
        spec: {
          sheetName: "Trend",
          title: "Monthly Trend",
          kind: "line",
          categories: ["2026-08"],
          series: [
            { name: "Created", values: [51] },
            { name: "Approved", values: [5] },
            { name: "Avg Cost", values: [8], axis: "right" }
          ]
        }
      }
    ]);
    const zip = await JSZip.loadAsync(out);

    // chart + drawing parts exist
    expect(zip.file("xl/charts/chart1.xml")).toBeTruthy();
    expect(zip.file("xl/charts/chart2.xml")).toBeTruthy();
    expect(zip.file("xl/drawings/drawing1.xml")).toBeTruthy();
    expect(zip.file("xl/drawings/_rels/drawing1.xml.rels")).toBeTruthy();

    // content types registered
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain('PartName="/xl/charts/chart1.xml"');
    expect(ct).toContain('PartName="/xl/drawings/drawing1.xml"');
    expect(ct).toContain("application/vnd.openxmlformats-officedocument.drawingml.chart+xml");

    // the sheet xml anchors the drawing
    const sheet1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet1).toMatch(/<drawing r:id="rId\d+"\/><\/worksheet>/);

    // the sheet rels point at the drawing
    const sheetRels = await zip.file("xl/worksheets/_rels/sheet1.xml.rels")!.async("string");
    expect(sheetRels).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"');
    expect(sheetRels).toContain('Target="../drawings/drawing1.xml"');

    // the workbook still opens with sheets intact
    const wb2 = XLSX.read(out, { type: "buffer" });
    expect(wb2.SheetNames).toEqual(["By Status", "Trend"]);
  });

  it("returns the buffer unchanged when no chart has categories", async () => {
    const buf = buildWorkbook();
    const out = await injectNativeCharts(buf, [{ sheetName: "By Status", spec: { ...barSpec, categories: [] } }]);
    expect(out).toEqual(buf);
  });

  it("skips charts whose sheet is not in the workbook", async () => {
    const out = await injectNativeCharts(buildWorkbook(), [{ sheetName: "Missing", spec: barSpec }]);
    const zip = await JSZip.loadAsync(out);
    expect(zip.file("xl/charts/chart1.xml")).toBeFalsy();
  });
});
