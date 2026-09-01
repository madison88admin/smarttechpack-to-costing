// Native Excel chart parts (OOXML) for the dashboard export.
//
// SheetJS Community Edition cannot emit charts, so these builders hand-write
// the chart/drawing XML parts that get injected into the workbook zip by
// inject-charts.ts. All builders are pure (string in, string out) so they are
// unit-testable in the node environment.

export type ChartSeriesSpec = {
  name: string;
  values: (string | number)[];
  /** Line charts only: plot against the secondary (right) axis. */
  axis?: "left" | "right";
};

export type NativeChartSpec = {
  sheetName: string;
  title: string;
  kind: "bar" | "line";
  categories: string[];
  series: ChartSeriesSpec[];
};

const CHART_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sheetRef(sheetName: string): string {
  const quoted = sheetName.replace(/'/g, "''");
  return `'${quoted}'`;
}

function cellRange(sheetName: string, col: string, startRow: number, endRow: number): string {
  return `${sheetRef(sheetName)}!$${col}$${startRow}:$${col}$${endRow}`;
}

function strCache(values: string[]): string {
  const pts = values
    .map((value, index) => `<c:pt idx="${index}"><c:v>${esc(value)}</c:v></c:pt>`)
    .join("");
  return `<c:strCache><c:ptCount val="${values.length}"/>${pts}</c:strCache>`;
}

function numCache(values: (string | number)[]): string {
  const pts = values
    .map((value, index) => `<c:pt idx="${index}"><c:v>${esc(value)}</c:v></c:pt>`)
    .join("");
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache>`;
}

function chartTitleXml(title: string): string {
  return [
    `<c:title>`,
    `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100" b="1"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx>`,
    `<c:overlay val="0"/>`,
    `</c:title>`,
    `<c:autoTitleDeleted val="0"/>`
  ].join("");
}

function seriesXml(
  idx: number,
  name: string,
  values: (string | number)[],
  categories: string[],
  sheetName: string,
  categoryCol: string,
  valueCol: string,
  dataStart: number,
  dataEnd: number
): string {
  const isNumeric = typeof values[0] === "number";
  const valRef = isNumeric
    ? `<c:numRef><c:f>${cellRange(sheetName, valueCol, dataStart, dataEnd)}</c:f>${numCache(values)}</c:numRef>`
    : `<c:strRef><c:f>${cellRange(sheetName, valueCol, dataStart, dataEnd)}</c:f>${strCache(values as string[])}</c:strRef>`;
  return [
    `<c:ser>`,
    `<c:idx val="${idx}"/>`,
    `<c:order val="${idx}"/>`,
    `<c:tx><c:strRef><c:f>${sheetRef(sheetName)}!$${valueCol}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`,
    `<c:cat><c:strRef><c:f>${cellRange(sheetName, categoryCol, dataStart, dataEnd)}</c:f>${strCache(categories)}</c:strRef></c:cat>`,
    `<c:val>${valRef}</c:val>`,
    `</c:ser>`
  ].join("");
}

function catAxXml(position: "b" | "l" = "b"): string {
  return [
    `<c:catAx>`,
    `<c:axId val="1"/>`,
    `<c:scaling><c:orientation val="minMax"/></c:scaling>`,
    `<c:delete val="0"/>`,
    `<c:axPos val="${position}"/>`,
    `<c:crossAx val="2"/>`,
    `<c:auto val="1"/>`,
    `<c:lblAlgn val="ctr"/>`,
    `<c:lblOffset val="100"/>`,
    `</c:catAx>`
  ].join("");
}

function valAxXml(id: number, crossAx: number, position: "l" | "r" | "b"): string {
  return [
    `<c:valAx>`,
    `<c:axId val="${id}"/>`,
    `<c:scaling><c:orientation val="minMax"/></c:scaling>`,
    `<c:delete val="0"/>`,
    `<c:axPos val="${position}"/>`,
    `<c:majorGridlines/>`,
    `<c:numFmt formatCode="General" sourceLinked="1"/>`,
    `<c:crossAx val="${crossAx}"/>`,
    `<c:crosses val="autoZero"/>`,
    `<c:crossBetween val="between"/>`,
    `</c:valAx>`
  ].join("");
}

/** Horizontal bar chart mirroring the web HBarChart (categories on the left,
 * values along the bottom). */
export function barChartXml(spec: NativeChartSpec): string {
  const dataStart = 2;
  const dataEnd = spec.categories.length + 1;
  const series = spec.series
    .map((item, index) =>
      seriesXml(
        index,
        item.name,
        item.values,
        spec.categories,
        spec.sheetName,
        "A",
        String.fromCharCode(66 + index),
        dataStart,
        dataEnd
      )
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${CHART_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">
  <c:chart>
    ${chartTitleXml(spec.title)}
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="bar"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        ${series}
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:barChart>
      ${catAxXml("l")}
      ${valAxXml(2, 1, "b")}
    </c:plotArea>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
  <c:printSettings/>
</c:chartSpace>`;
}

/** Line chart mirroring the web LineChart (created/approved on the left axis).
 * When any series has axis "right", emits a combo chart: left-axis series in
 * the primary line chart, right-axis series in a secondary line chart sharing
 * the category axis with its own value axis. */
export function lineChartXml(spec: NativeChartSpec): string {
  const dataStart = 2;
  const dataEnd = spec.categories.length + 1;
  const left = spec.series.filter((item) => item.axis !== "right");
  const right = spec.series.filter((item) => item.axis === "right");
  const hasRight = right.length > 0;

  const lineBlock = (items: ChartSeriesSpec[], baseIdx: number, valueCols: string[], valAxId: number) =>
    `<c:lineChart>
       <c:grouping val="standard"/>
       <c:varyColors val="0"/>
       ${items
         .map((item, index) =>
           seriesXml(baseIdx + index, item.name, item.values, spec.categories, spec.sheetName, "A", valueCols[index], dataStart, dataEnd)
         )
         .join("")}
       <c:marker val="1"/>
       <c:smooth val="0"/>
       <c:axId val="1"/>
       <c:axId val="${valAxId}"/>
     </c:lineChart>`;

  const primary = lineBlock(left, 0, ["B", "C"], 2);
  const secondary = hasRight ? lineBlock(right, left.length, ["D"], 3) : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${CHART_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">
  <c:chart>
    ${chartTitleXml(spec.title)}
    <c:plotArea>
      <c:layout/>
      ${primary}
      ${secondary}
      ${catAxXml("b")}
      ${valAxXml(2, 1, "l")}
      ${hasRight ? valAxXml(3, 1, "r") : ""}
    </c:plotArea>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
  <c:printSettings/>
</c:chartSpace>`;
}

/** Spreadsheet drawing part that anchors the chart on a sheet. */
export function drawingXml(chartRId: string, name = "Chart 1", fromCol = 4, fromRow = 1, toCol = 14, toRow = 22): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:twoCellAnchor xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${A_NS}" xmlns:r="${R_NS}" editAs="oneCell">
  <xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
  <xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
  <xdr:graphicFrame macro="">
    <xdr:nvGraphicFramePr>
      <xdr:cNvPr id="2" name="${esc(name)}"/>
      <xdr:cNvGraphicFramePr/>
    </xdr:nvGraphicFramePr>
    <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
    <a:graphic>
      <a:graphicData uri="${CHART_NS}">
        <c:chart xmlns:c="${CHART_NS}" xmlns:r="${R_NS}" r:id="${chartRId}"/>
      </a:graphicData>
    </a:graphic>
  </xdr:graphicFrame>
  <xdr:clientData/>
</xdr:twoCellAnchor>`;
}

/** Relationships part for a drawing — points at its chart part. */
export function drawingRelsXml(chartFileName: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_NS}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/${chartFileName}"/>
</Relationships>`;
}
