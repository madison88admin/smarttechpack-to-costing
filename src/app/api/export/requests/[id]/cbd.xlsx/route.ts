import * as XLSX from "xlsx";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentRole, canRunCostingAction, canRunPbdAction } from "@/lib/auth/roles";

export async function GET(_: Request, context: { params: { id: string } }) {
  const role = getCurrentRole();
  if (!(canRunCostingAction(role) || canRunPbdAction(role) || role === "manager")) return new Response("Unauthorized", { status: 401 });
  const supabase = createSupabaseServiceClient();
  const { data: request, error } = await supabase.from("costing_requests").select("id,request_number,factory_name,nextgen_products(style_number,name),factory_cbds(raw_payload,submitted_at)").eq("id", context.params.id).maybeSingle();
  if (error || !request) return new Response("Request not found", { status: 404 });
  const product = Array.isArray(request.nextgen_products) ? request.nextgen_products[0] : request.nextgen_products;
  const cbd = Array.isArray(request.factory_cbds) ? [...request.factory_cbds].sort((a,b)=>String(b.submitted_at??"").localeCompare(String(a.submitted_at??"")))[0] : request.factory_cbds;
  const payload = (cbd?.raw_payload ?? {}) as Record<string, any>;
  const header = payload.header ?? {};
  const rows: any[][] = [["Factory Cost Breakdown", "Customer:", header.customer ?? ""], ["YARN", "CONSUMPTION (G)", "MATERIAL PRICE (USD/KG)", "MATERIAL COST", "Season:", header.season ?? ""], ["", "", "", "", "Style#:", header.styleNumber ?? product?.style_number ?? ""], ["", "", "", "", "Style Name:", header.styleName ?? product?.name ?? ""], ["", "", "", "", "MOQ:", payload.moq ?? ""], ["", "", "", "", "Leadtime:", header.leadTimeDays ?? ""], ...(payload.yarnLines ?? []).map((l:any)=>[l.name??"",l.consumption??0,l.materialPrice??0,l.materialCost??0]), ["FABRIC", "CONSUMPTION (YARDS)", "MATERIAL PRICE (USD/YD)", "MATERIAL COST"], ...(payload.fabricLines ?? []).map((l:any)=>[l.name??"",l.consumption??0,l.materialPrice??0,l.materialCost??0]), ["TRIM", "CONSUMPTION (PIECE)", "MATERIAL PRICE (USD/PC)", "MATERIAL COST"], ...(payload.trimLines ?? []).map((l:any)=>[l.name??"",l.consumption??0,l.materialPrice??0,l.materialCost??0]), ["TOTAL MATERIAL AND SUBMATERIALS COST", payload.materialTotal ?? 0], ["KNITTING", "KNITTING TIME (MINS)", "KNITTING SAH (USD/MIN)", "KNITTING COST"], ...(payload.knittingLines ?? []).map((l:any)=>[l.machineType??"",l.knittingTime??0,l.sah??0,l.knittingCost??0]), ["OPERATIONS", "Factory Notes", "OPERATION COST"], ...(payload.operationsLines ?? []).map((l:any)=>[l.operation??"",payload.operationsNotes??"",l.operationCost??0]), ["PACKAGING", "Factory Notes", "COST"], ["Standard Packaging", payload.packagingNotes ?? "", payload.standardPackagingCost ?? 0], ["Special Packaging", payload.packagingNotes ?? "", payload.specialPackagingCost ?? 0], ["OVERHEAD/PROFIT", "Factory Notes", "COST"], ["OVERHEAD", payload.overheadNotes ?? "", payload.overheadCost ?? 0], ["PROFIT", payload.overheadNotes ?? "", payload.profitCost ?? 0], ["TOTAL FACTORY COST", payload.factoryCostTotal ?? payload.grandTotal ?? 0], ["NOTES", payload.notes ?? ""], ["COSTING LEARNINGS", payload.costingLearning ?? ""]];
  const sheet = XLSX.utils.aoa_to_sheet(rows); sheet["!cols"] = [{wch:42},{wch:20},{wch:24},{wch:18},{wch:18},{wch:34}];
  for (const cell of ["A1","A2","A7","A12","A16","A20","A24"]) if (sheet[cell]) sheet[cell].s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1F5B4D" } } };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet, "Factory CBD");
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Response(new Uint8Array(out), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${request.request_number ?? context.params.id}-factory-cbd.xlsx"` } });
}
