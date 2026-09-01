import { toCsv } from "@/lib/export/csv";
import type { ReportRequestRow } from "@/lib/reporting";
import { maskStatusForRole, statusLabels } from "@/lib/workflow/status";

export const REGISTER_EXPORT_HEADERS = [
  "request_number",
  "style_number",
  "product_name",
  "factory_name",
  "brand",
  "customer",
  "season",
  "product_category",
  "status",
  "created_at",
  "updated_at",
  "request_id"
] as const;

export type RegisterExportRow = {
  request_number: string;
  style_number: string;
  product_name: string;
  factory_name: string;
  brand: string;
  customer: string;
  season: string;
  product_category: string;
  status: string;
  created_at: string;
  updated_at: string;
  request_id: string;
};

/** Maps report rows into flat export records, applying role masking to status. */
export function buildRegisterExportRows(rows: ReportRequestRow[], role: string): RegisterExportRow[] {
  return rows.map((row) => {
    const status = maskStatusForRole(row.status, role);
    return {
      request_number: row.request_number ?? "",
      style_number: row.style_number ?? "",
      product_name: row.product_name ?? "",
      factory_name: row.factory_name ?? "",
      brand: row.brand ?? "",
      customer: row.customer ?? "",
      season: row.season ?? "",
      product_category: row.product_category ?? "",
      status: (statusLabels as Record<string, string>)[status] ?? status.replace(/_/g, " "),
      created_at: row.created_at,
      updated_at: row.updated_at,
      request_id: row.id
    };
  });
}

/** CSV string for the full filtered register (all rows, not just the visible page). */
export function registerCsv(rows: ReportRequestRow[], role: string): string {
  return toCsv(
    buildRegisterExportRows(rows, role) as unknown as Array<Record<string, unknown>>,
    [...REGISTER_EXPORT_HEADERS]
  );
}
