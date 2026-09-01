// Injects native OOXML chart parts (charts + drawings) into a SheetJS-written
// xlsx buffer by editing the workbook zip with jszip. SheetJS CE cannot emit
// charts, so after XLSX.write we:
//   1. add xl/charts/chartN.xml + xl/drawings/drawingN.xml (+ rels)
//   2. register the parts in [Content_Types].xml
//   3. anchor each drawing on its sheet via <drawing r:id="..."/> + sheet rels
import JSZip from "jszip";
import { barChartXml, lineChartXml, drawingXml, drawingRelsXml, type NativeChartSpec } from "./chart-parts";

const DRAWING_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const CHART_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
const PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

const DRAWING_CT = "application/vnd.openxmlformats-officedocument.drawing+xml";
const CHART_CT = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

export type NativeChartSheet = {
  /** Must match the workbook sheet name the chart anchors to. */
  sheetName: string;
  spec: NativeChartSpec;
};

function nextRId(relsXml: string): string {
  let max = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return `rId${max + 1}`;
}

export async function injectNativeCharts(buffer: Buffer, charts: NativeChartSheet[]): Promise<Buffer> {
  const usable = charts.filter((chart) => chart.spec.categories.length > 0);
  if (usable.length === 0) return buffer;

  const zip = await JSZip.loadAsync(buffer);

  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const workbookRels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
  if (!workbookXml || !workbookRels || !contentTypes) {
    throw new Error("Not a valid xlsx workbook (missing workbook.xml/rels/content types)");
  }

  // sheet name -> worksheets/sheetN.xml via workbook rels
  const relsById = new Map<string, string>();
  for (const m of workbookRels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relsById.set(m[1], m[2]);
  }
  const sheetTargets = new Map<string, string>();
  for (const m of workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = relsById.get(m[2]);
    if (target) sheetTargets.set(m[1], target.replace(/^\//, ""));
  }

  // Register every chart + drawing part in [Content_Types].xml.
  const parts: { chartFile: string; drawingFile: string; sheetFile: string }[] = [];
  usable.forEach((chart, index) => {
    const sheetFile = sheetTargets.get(chart.sheetName);
    if (!sheetFile) return;
    parts.push({ chartFile: `chart${index + 1}.xml`, drawingFile: `drawing${index + 1}.xml`, sheetFile });
  });
  if (parts.length === 0) return buffer;

  const overrides = parts
    .map(
      (p) =>
        `<Override PartName="/xl/charts/${p.chartFile}" ContentType="${CHART_CT}"/>` +
        `<Override PartName="/xl/drawings/${p.drawingFile}" ContentType="${DRAWING_CT}"/>`
    )
    .join("");
  zip.file("[Content_Types].xml", contentTypes.replace("</Types>", `${overrides}</Types>`));

  for (let i = 0; i < usable.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    const { chartFile, drawingFile, sheetFile } = part;
    const chart = usable[i];

    zip.file(`xl/charts/${chartFile}`, chart.spec.kind === "bar" ? barChartXml(chart.spec) : lineChartXml(chart.spec));
    zip.file(`xl/drawings/${drawingFile}`, drawingXml("rId1", chart.spec.title));
    zip.file(`xl/drawings/_rels/${drawingFile}.rels`, drawingRelsXml(chartFile));

    // Anchor the drawing on the sheet: add a <drawing> element + sheet rel.
    const sheetXml = await zip.file(`xl/${sheetFile}`)?.async("string");
    if (!sheetXml) continue;

    const sheetRelsFile = `xl/${sheetFile.replace(/^worksheets\//, "worksheets/_rels/").replace(/\.xml$/, ".xml.rels")}`;
    const existingRels = (await zip.file(sheetRelsFile)?.async("string")) ?? "";
    const relId = existingRels ? nextRId(existingRels) : "rId1";
    const newRel = `<Relationship Id="${relId}" Type="${DRAWING_REL_NS}" Target="../drawings/${drawingFile}"/>`;
    zip.file(
      sheetRelsFile,
      existingRels
        ? existingRels.replace("</Relationships>", `${newRel}</Relationships>`)
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_NS}">${newRel}</Relationships>`
    );
    zip.file(`xl/${sheetFile}`, sheetXml.replace(/<\/worksheet>/, `<drawing r:id="${relId}"/></worksheet>`));
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}
