import * as XLSX from "xlsx";

export type ParsedCbdData = {
  customer: string | null;
  season: string | null;
  styleNumber: string | null;
  styleName: string | null;
  costedQty: string | null;
  leadTimeDays: number | null;
  finishWeight: string | null;
  moq: number | null;
  yarnLines: Array<{ name: string; consumption: string; materialPrice: string; materialCost: string; fobPrice?: string; surchargePercent?: string; freightCost?: string; markupPercent?: string }>;
  fabricLines: Array<{ name: string; consumption: string; materialPrice: string; materialCost: string }>;
  trimLines: Array<{ name: string; consumption: string; materialPrice: string; materialCost: string }>;
  knittingLines: Array<{ machineType: string; knittingTime: string; sah: string; knittingCost: string }>;
  operationsLines: Array<{ operation: string; operationCost: string }>;
  standardPackagingCost: number | null;
  specialPackagingCost: number | null;
  overheadCost: number | null;
  profitCost: number | null;
  totalFactoryCost: number | null;
  sourceFileName?: string | null;
  sourceFileType?: "excel" | "pdf" | null;
  warnings: string[];
  errors: string[];
};

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function cleanText(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function parseNumberWithCurrency(v: unknown): number | null {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  // Remove currency symbols, units, %, and keep digits, dot, comma, minus
  s = s.replace(/[^0-9.,-]/g, "");
  // Handle "50g" -> "50", "0.1 yards" -> "0.1"
  s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function extractNumber(v: string): number | null {
  const m = v.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// Simple text extraction from PDF binary (works for digital PDFs without extra deps)
async function extractPdfText(buffer: Buffer): Promise<string> {
  // Fallback: naive text extraction from PDF binary (works for digital PDFs)
  const raw = buffer.toString("latin1");
  const texts: string[] = [];
  // Extract text between parentheses (PDF text objects) and TJ arrays
  const paren = /\(([^()]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = paren.exec(raw))) {
    const t = m[1].replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\");
    // Heuristic: ignore very short or binary garbage
    if (t.length > 1 && /[a-zA-Z0-9]/.test(t)) texts.push(t);
  }
  // Also try to extract TJ array text like [(Hello) 20 (World)] TJ
  if (texts.length < 10) {
    const tj = /\[([^\]]*)\]\s*TJ/g;
    while ((m = tj.exec(raw))) {
      const inner = m[1];
      const innerParen = /\(([^()]*)\)/g;
      let im: RegExpExecArray | null;
      while ((im = innerParen.exec(inner))) {
        const t = im[1];
        if (t.length > 1 && /[a-zA-Z0-9]/.test(t)) texts.push(t);
      }
    }
  }
  const joined = texts.join("\n");
  // If still very little text, assume scanned image PDF
  if (joined.trim().length < 50) {
    throw new Error("Scanned PDF detected — text extraction failed. Please use the Excel template (.xlsx) for scanned documents, or ensure the PDF is text-based (not an image scan).");
  }
  return joined;
}

function parsePdfTextToRows(text: string): string[][] {
  // Split into lines, then split each line into cells where possible
  // PDFs are not tabular, so we heuristically split by 2+ spaces or tabs or |
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    // Try to split by |, then 2+ spaces, then single tab, then single space for numbers
    if (line.includes("|")) return line.split("|").map((c) => c.trim());
    if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((c) => c.trim());
    // For lines like "YARN 50 5 0.25" split by single space but keep first token as name
    return line.split(/\s+/).map((c) => c.trim());
  });
}

export async function parseCbdPdf(buffer: Buffer, fileName?: string): Promise<ParsedCbdData> {
  if (buffer.length > MAX_FILE_BYTES) throw new Error(`PDF too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`);
  if (buffer.length < 4 || buffer.slice(0, 4).toString() !== "%PDF") {
    throw new Error("Invalid PDF file — missing PDF header.");
  }
  const text = await extractPdfText(buffer);
  const rows = parsePdfTextToRows(text);
  // Reuse the same section-aware parser but on text rows
  return parseRowsToCbd(rows, fileName, "pdf");
}

function parseRowsToCbd(rows: unknown[][], fileName?: string | null, fileType: "excel" | "pdf" = "excel"): ParsedCbdData {
  const W: string[] = [];
  const E: string[] = [];
  const R: ParsedCbdData = {
    customer: null, season: null, styleNumber: null, styleName: null,
    costedQty: null, leadTimeDays: null, finishWeight: null, moq: null,
    yarnLines: [], fabricLines: [], trimLines: [], knittingLines: [], operationsLines: [],
    standardPackagingCost: null, specialPackagingCost: null,
    overheadCost: null, profitCost: null, totalFactoryCost: null,
    sourceFileName: fileName ?? null, sourceFileType: fileType, warnings: W, errors: E
  };
  const gs = (r: number, c: number): string => {
    const row = rows[r] as unknown[] | undefined;
    if (!row) return "";
    return cleanText(row[c]);
  };
  const gn = (r: number, c: number): number | null => parseNumberWithCurrency(rows[r]?.[c as number]);

  const fsec = (kws: string[]): number => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as unknown[] | undefined;
      if (!row) continue;
      const line = row.map((c) => cleanText(c).toLowerCase()).join(" ");
      if (kws.some((kw) => line.includes(kw.toLowerCase()))) return i;
    }
    return -1;
  };

  const HEADER_SET = new Set(["customer", "season", "style", "style #", "style no", "style number", "style name", "moq", "leadtime", "lead time", "finish weight", "sample weight", "costed qty", "costed qty", "qty", "proto", "weight"]);
  const isHeader = (v: string) => {
    const low = v.toLowerCase().trim();
    if (HEADER_SET.has(low)) return true;
    // Also treat exact header-like phrases as header, but not values like "Test Customer" or "Internal Live Test"
    // Values that are short and match a header keyword exactly are headers; longer values containing keyword are data
    if (low === "customer" || low === "season") return true;
    // For style, moq etc, check if the whole string is a header (allow "Style #" etc)
    return false;
  };

  // Header scan: first 12 rows, all columns - strict next-cell lookup to avoid picking next header as value
  for (let i = 0; i < Math.min(12, rows.length); i++) {
    const row = rows[i] as unknown[] | undefined;
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cell = cleanText(row[j]).toLowerCase();
      const immediateNext = gs(i, j + 1);
      const nextVals = [gs(i, j + 1), gs(i, j + 2), gs(i, j + 3)].filter(Boolean);
      const nextText = nextVals.join(" ");

      if (cell.includes("customer") && !R.customer) {
        // Prefer immediate next cell if it's not a header
        const v = immediateNext && !isHeader(immediateNext) && immediateNext.length > 1 ? immediateNext : nextVals.find((v2) => v2 && !isHeader(v2) && v2.length > 1);
        if (v) R.customer = v;
      }
      if (cell.includes("season") && !R.season) {
        const v = immediateNext && !isHeader(immediateNext) && immediateNext.length > 1 ? immediateNext : nextVals.find((v2) => v2 && !isHeader(v2) && v2.length > 1);
        if (v) R.season = v;
      }
      if ((cell.includes("style") && (cell.includes("#") || cell.includes("number") || cell.includes("no"))) && !R.styleNumber) {
        const v = immediateNext && !isHeader(immediateNext) && /^[A-Za-z0-9-_]+$/.test(immediateNext) && immediateNext.length >= 3 ? immediateNext : nextVals.find((v2) => v2 && !isHeader(v2) && /^[A-Za-z0-9-_]+$/.test(v2) && v2.length >= 3);
        if (v) R.styleNumber = v;
        else {
          const v2 = nextVals.find((v3) => v3 && !isHeader(v3) && v3.length >= 2);
          if (v2) R.styleNumber = v2;
        }
      }
      if (cell.includes("style name") && !R.styleName) {
        const v = immediateNext && !isHeader(immediateNext) ? immediateNext : nextVals.find((v2) => v2 && !isHeader(v2));
        if (v) R.styleName = v;
      }
      if (cell.includes("costed qty") && !R.costedQty) {
        const v = immediateNext && !isHeader(immediateNext) ? immediateNext : nextVals.find((v2) => v2 && !isHeader(v2));
        if (v) R.costedQty = v;
      }
      if ((cell === "moq" || cell.includes("moq")) && R.moq == null) {
        const m = nextText.match(/(\d[\d,]*)/);
        if (m) R.moq = Number(m[1].replace(/,/g, ""));
        else if (immediateNext) {
          const n = parseNumberWithCurrency(immediateNext);
          if (n != null) R.moq = n;
        }
      }
      if ((cell.includes("leadtime") || cell.includes("lead time")) && R.leadTimeDays == null) {
        const m = nextText.match(/(\d+)\s*(days?|d)?/i);
        if (m) R.leadTimeDays = parseInt(m[1], 10);
        else {
          const n = parseNumberWithCurrency(immediateNext);
          if (n != null) R.leadTimeDays = n;
        }
      }
      if ((cell.includes("finish weight") || cell.includes("sample weight")) && !R.finishWeight) {
        const v = immediateNext && !isHeader(immediateNext) ? immediateNext : nextVals.find((v2) => v2 && !isHeader(v2));
        if (v) R.finishWeight = v;
      }
    }
  }

  // Also try regex on whole text for PDF fallback where headers are inline like "Customer: VANS"
  const allText = rows.map((r) => (r as unknown[]).map((c) => cleanText(c)).join(" ")).join("\n");
  if (!R.customer) {
    const m = allText.match(/Customer\s*[:\-]?\s*([A-Za-z0-9 ,.&'-]+)/i);
    if (m) R.customer = cleanText(m[1]).split(/\s{2,}/)[0].trim().slice(0, 40);
  }
  if (!R.season) {
    const m = allText.match(/Season\s*[:\-]?\s*([A-Za-z0-9-_]+)/i);
    if (m) R.season = m[1].trim();
  }

  const yH = fsec(["yarn"]);
  const fH = fsec(["fabric"]);
  const tH = fsec(["trim"]);
  const kH = fsec(["knitting"]);
  const oH = fsec(["operations", "operation"]);
  const pH = fsec(["packaging"]);
  const hH = fsec(["overhead"]);
  const cH = fsec(["total factory cost", "factory cost total", "total cost"]);

  const pm = (s: number, e: number) => {
    const L: Array<{ name: string; consumption: string; materialPrice: string; materialCost: string }> = [];
    if (s < 0) return L;
    const end = e >= 0 ? e : Math.min(s + 18, rows.length);
    for (let i = s + 1; i < end; i++) {
      const first = cleanText((rows[i] as unknown[])?.[0]);
      const low = first.toLowerCase();
      if (!first || first === "0" || low.includes("total") || low.includes("sub total") || low.includes("----")) break;
      // Skip header rows like "Material", "Consumption"
      if (["material", "consumption", "price", "cost", "yarn", "fabric", "trim"].some((k) => low === k)) continue;
      const c = gn(i, 1);
      const pr = gn(i, 2);
      const t = gn(i, 3);
      // Also try to parse "50g" style: consumption may be in column 0 with name
      const hasValue = c != null || pr != null || t != null || /\d/.test(first);
      if (!hasValue) continue;
      // If row is like "100%ACRYLIC 50 5 0.25" but split incorrectly, try to re-parse from raw line
      if (c == null && pr == null && t == null && first.includes(" ")) {
        const parts = first.split(/\s+/);
        if (parts.length >= 4) {
          const maybeName = parts.slice(0, -3).join(" ");
          const maybeC = parseNumberWithCurrency(parts[parts.length - 3]);
          const maybePr = parseNumberWithCurrency(parts[parts.length - 2]);
          const maybeT = parseNumberWithCurrency(parts[parts.length - 1]);
          if (maybeC || maybePr || maybeT) {
            L.push({ name: maybeName || first, consumption: maybeC?.toString() ?? "", materialPrice: maybePr?.toString() ?? "", materialCost: maybeT?.toString() ?? "" });
            continue;
          }
        }
      }
      L.push({ name: first, consumption: c?.toString() ?? "", materialPrice: pr?.toString() ?? "", materialCost: t?.toString() ?? "" });
    }
    return L;
  };

  if (yH >= 0) R.yarnLines = pm(yH, fH >= 0 ? fH : tH >= 0 ? tH : kH >= 0 ? kH : yH + 18);
  if (fH >= 0) R.fabricLines = pm(fH, tH >= 0 ? tH : kH >= 0 ? kH : fH + 18);
  if (tH >= 0) R.trimLines = pm(tH, kH >= 0 ? kH : tH + 18);

  if (kH >= 0) {
    const end = oH >= 0 ? oH : kH + 18;
    for (let i = kH + 1; i < Math.min(end, rows.length); i++) {
      const name = gs(i, 0);
      if (!name || name === "0") continue;
      const low = name.toLowerCase();
      if (low.includes("total") || low.includes("sub total")) break;
      if (["machine", "time", "sah", "cost"].some((k) => low === k)) continue;
      const t = gn(i, 1);
      const s = gn(i, 2);
      const c = gn(i, 3);
      if (t != null || s != null || c != null) R.knittingLines.push({ machineType: name, knittingTime: t?.toString() ?? "", sah: s?.toString() ?? "", knittingCost: c?.toString() ?? "" });
    }
  }

  if (oH >= 0) {
    const end = pH >= 0 ? pH : oH + 22;
    for (let i = oH + 1; i < Math.min(end, rows.length); i++) {
      const name = gs(i, 0);
      if (!name || name === "0") continue;
      if (name.toLowerCase().includes("sub total")) break;
      if (["operation", "cost"].some((k) => name.toLowerCase() === k)) continue;
      const c = gn(i, 3) ?? gn(i, 2) ?? gn(i, 1);
      if (name && c != null) R.operationsLines.push({ operation: name, operationCost: c.toString() });
      else if (name && /\d/.test(gs(i, 1) + gs(i, 2) + gs(i, 3))) {
        // Try last column
        const last = gn(i, 3) ?? gn(i, 2);
        if (last != null) R.operationsLines.push({ operation: name, operationCost: last.toString() });
      }
    }
  }

  if (pH >= 0) {
    const end = hH >= 0 ? hH : pH + 12;
    for (let i = pH + 1; i < Math.min(end, rows.length); i++) {
      const name = cleanText((rows[i] as unknown[])?.[0]).toLowerCase();
      const c = gn(i, 3) ?? gn(i, 2) ?? gn(i, 1);
      if (name.includes("standard") && c != null) R.standardPackagingCost = c;
      else if (name.includes("special") && c != null) R.specialPackagingCost = c;
      else if (name.includes("packaging") && c != null && R.standardPackagingCost == null) R.standardPackagingCost = c;
    }
  }

  if (hH >= 0) {
    const end = cH >= 0 ? cH : hH + 12;
    for (let i = hH + 1; i < Math.min(end, rows.length); i++) {
      const name = cleanText((rows[i] as unknown[])?.[0]).toLowerCase();
      const c = gn(i, 3) ?? gn(i, 2) ?? gn(i, 1);
      if (name.includes("overhead") && c != null) R.overheadCost = c;
      else if (name.includes("profit") && c != null) R.profitCost = c;
    }
  }

  if (cH >= 0) {
    R.totalFactoryCost = gn(cH, 3) ?? gn(cH, 2) ?? gn(cH, 1);
    if (R.totalFactoryCost == null) {
      // Try same row, last non-empty numeric
      const row = rows[cH] as unknown[] | undefined;
      if (row) {
        for (let k = row.length - 1; k >= 0; k--) {
          const n = parseNumberWithCurrency(row[k]);
          if (n != null && n > 0) { R.totalFactoryCost = n; break; }
        }
      }
    }
  }

  // Warnings with row context
  if (!R.customer) W.push("Customer not found — check header row 1-12, column near 'Customer'");
  if (!R.styleNumber) W.push("Style number not found — look for 'Style #' or 'Style No' in header");
  if (R.yarnLines.length === 0) W.push("No yarn lines found — ensure a 'YARN' section exists");
  if (R.yarnLines.length > 0 && R.yarnLines.some((l) => !l.consumption)) W.push("Some yarn lines missing consumption — verify column 1 (g)");
  if (R.knittingLines.length === 0) W.push("No knitting lines found — check 'KNITTING' section");
  if (R.operationsLines.length === 0) W.push("No operations found — check 'OPERATIONS' section");
  if (R.totalFactoryCost == null) W.push("Total Factory Cost not found — check final 'TOTAL FACTORY COST' row");
  if (fileType === "pdf" && R.yarnLines.length === 0 && R.fabricLines.length === 0) {
    W.push("PDF text extraction may be incomplete — if this is a scanned PDF, please use Excel (.xlsx) instead.");
  }

  return R;
}

export function parseCbdExcel(buffer: Buffer | ArrayBuffer, fileName?: string): ParsedCbdData {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
  if (buf.length > MAX_FILE_BYTES) throw new Error(`File too large (${(buf.length / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`);
  // Detect PDF accidentally sent as Excel
  if (buf.slice(0, 4).toString() === "%PDF") {
    throw new Error("This is a PDF file — please use PDF import or convert to Excel. The Excel parser cannot read PDFs.");
  }
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellDates: true, raw: false });
  } catch (e) {
    throw new Error(`Excel read failed: ${e instanceof Error ? e.message : "corrupt file"}. Please re-save as .xlsx and retry.`);
  }
  const sn = wb.SheetNames[0];
  if (!sn) throw new Error("No sheets found — file is empty.");
  const sheet = wb.Sheets[sn];
  if (!sheet) throw new Error("No sheet data.");
  // Try to detect if this is actually a CSV or wrong sheet
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: false });
  if (rows.length < 5) throw new Error("File too short — expected at least 5 rows for a valid CBD. Check template.");
  return parseRowsToCbd(rows as unknown[][], fileName, "excel");
}

export async function parseCbdFile(buffer: Buffer, fileName: string): Promise<ParsedCbdData> {
  const ext = fileName.toLowerCase().split(".").pop();
  const isPdf = ext === "pdf" || buffer.slice(0, 4).toString() === "%PDF";
  if (isPdf) {
    return parseCbdPdf(buffer, fileName);
  }
  // Excel fallback (.xlsx, .xls, .csv)
  return parseCbdExcel(buffer, fileName);
}

export function validateParsedCbd(data: ParsedCbdData) {
  const errors: string[] = [];
  if (!data.customer) errors.push("Customer is required — add 'Customer' in header (row 1-3)");
  if (!data.styleNumber) errors.push("Style number is required — add 'Style #' in header");
  if (data.yarnLines.length === 0 && data.fabricLines.length === 0 && data.trimLines.length === 0) {
    errors.push("At least one material line is required — add a row under YARN/FABRIC/TRIM");
  }
  // Additional hard checks for PDF where extraction often misses
  if (data.sourceFileType === "pdf" && data.yarnLines.length === 0 && data.fabricLines.length === 0) {
    errors.push("PDF extraction found no materials — scanned PDFs are not supported. Please upload the Excel template.");
  }
  return { isValid: errors.length === 0, errors, warnings: data.warnings };
}
