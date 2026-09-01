export function toCsv(rows: Array<Record<string, unknown>>, headers?: string[]) {
  const resolvedHeaders = headers ?? Object.keys(rows[0] ?? {});

  if (!resolvedHeaders.length) return "";

  const lines = [
    resolvedHeaders.join(","),
    ...rows.map((row) => resolvedHeaders.map((header) => escapeCsv(row[header])).join(","))
  ];

  return `${lines.join("\n")}\n`;
}

export function csvResponse(filename: string, csv: string) {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}

function escapeCsv(value: unknown) {
  if (value === null || value === undefined) return "";

  const text = value instanceof Date ? value.toISOString() : String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}
