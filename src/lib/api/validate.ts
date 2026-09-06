import { NextResponse } from "next/server";
import { z, type ZodSchema } from "zod";
import { routeActionNames } from "@/lib/costing/actions";

/**
 * Preprocess helper: converts empty strings / null / undefined to undefined
 * (so .optional() kicks in), and coerces string numbers to actual numbers.
 * This allows form fields that send strings (e.g. "5.50" or "") to validate.
 */
const optionalNumber = z.preprocess((val) => {
  if (val === "" || val === null || val === undefined) return undefined;
  const n = typeof val === "string" ? Number(val.replace(/,/g, "")) : Number(val);
  return Number.isFinite(n) ? n : undefined;
}, z.number().min(0).optional());

const optionalInt = z.preprocess((val) => {
  if (val === "" || val === null || val === undefined) return undefined;
  const n = typeof val === "string" ? Number(val.replace(/,/g, "")) : Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}, z.number().int().min(0).optional());

const optionalPercent = z.preprocess((val) => {
  if (val === "" || val === null || val === undefined) return undefined;
  const n = typeof val === "string" ? Number(val.replace(/,/g, "")) : Number(val);
  return Number.isFinite(n) ? n : undefined;
}, z.number().min(0).max(100).optional());

const optionalString = z.preprocess((val) => {
  if (val === null || val === undefined) return undefined;
  return String(val).trim();
}, z.string().max(500).optional());

/**
 * Validate request body against a Zod schema.
 * Returns { success: true, data } or { success: false, response }.
 */
export function validateBody<T>(schema: ZodSchema<T>, body: unknown):
  | { success: true; data: T }
  | { success: false; response: NextResponse } {
  const result = schema.safeParse(body);

  if (!result.success) {
    const firstError = result.error.issues[0];
    const message = firstError
      ? `${firstError.path.join(".")}: ${firstError.message}`
      : "Invalid request body";

    return {
      success: false,
      response: NextResponse.json(
        { ok: false, error: message },
        { status: 400 }
      )
    };
  }

  return { success: true, data: result.data };
}

// === Common schemas ===

export const styleNumberSchema = z.string().trim().min(1).max(50);
export const factoryNameSchema = z.string().trim().min(1).max(100);
export const seasonSchema = z.string().trim().max(20).optional();
export const brandSchema = z.string().trim().max(100).optional();
export const customerSchema = z.string().trim().max(100).optional();
export const notesSchema = z.string().trim().max(2000).optional();
export const requestIdSchema = z.string().uuid();

/**
 * Validate that a route param is a valid UUID.
 * Returns null if valid, or a 400 NextResponse if invalid.
 */
export function validateRequestId(id: string): NextResponse | null {
  const result = requestIdSchema.safeParse(id);
  if (!result.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request id: must be a valid UUID" },
      { status: 400 }
    );
  }
  return null;
}

export const bomLineSchema = z.object({
  id: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  materialName: z.string().trim().min(1).max(200).optional(),
  materialDescription: z.string().max(500).optional(),
  materialType: z.string().max(100).optional(),
  usage: z.union([z.string(), z.number()]).optional(),
  size: z.string().max(50).optional(),
  headerVersion: z.string().max(50).optional(),
  bomVersionComment: z.string().max(500).optional(),
  raw: z.unknown().optional()
});

export const createRequestSchema = z.object({
  styleNumber: styleNumberSchema,
  productName: z.string().trim().max(200).optional(),
  nextgenEntityId: z.string().trim().max(100).optional(),
  nextgenRaw: z.unknown().optional(),
  factoryName: z.string().trim().max(100).optional(),
  season: seasonSchema,
  brand: brandSchema,
  customer: customerSchema,
  poNumber: z.string().trim().max(50).optional(),
  mpoNumber: z.string().trim().max(50).optional(),
  productCategory: z.string().trim().max(100).optional(),
  buyerStyleNumber: z.string().trim().max(100).optional(),
  notes: notesSchema,
  bomLines: z.array(bomLineSchema).optional(),
  forceCreate: z.boolean().optional(),
  // Snapshot of the comparable approved costing copied in via Like Styles.
  baselineRef: z.unknown().optional()
});

export const bulkCreateSchema = z.object({
  items: z.array(z.object({
    styleNumber: styleNumberSchema,
    productName: z.string().trim().max(200).optional(),
    entityId: z.string().trim().min(1).max(100),
    bomLines: z.array(bomLineSchema).min(1, "BOM lines required from NextGen"),
    notes: notesSchema
  })).min(1).max(50),
  factoryName: z.string().trim().max(100).optional(),
  season: seasonSchema,
  brand: brandSchema,
  customer: customerSchema
});

// The action vocabulary is owned by src/lib/costing/actions.ts; this schema
// accepts exactly the actions-route subset (everything except factory `submit`).
export const actionSchema = z.object({
  action: z.enum(routeActionNames as [string, ...string[]]),
  comment: z.string().trim().max(2000).optional()
});

export const cbdLineItemSchema = z.object({
  name: z.string().trim().max(300).optional(),
  consumption: optionalNumber,
  materialPrice: optionalNumber,
  materialCost: optionalNumber,
  machineType: z.string().trim().max(100).optional(),
  knittingTime: optionalNumber,
  sah: optionalNumber,
  knittingCost: optionalNumber,
  operation: z.string().trim().max(200).optional(),
  operationCost: optionalNumber,
  sortOrder: z.number().optional(),
  // Yarn material price computation breakdown
  fobPrice: optionalNumber,
  surchargePercent: optionalNumber,
  freightCost: optionalNumber,
  markupPercent: optionalNumber
});

export const cbdSubmitSchema = z.object({
  status: z.enum(["draft", "submitted"]).optional(),
  currency: z.string().trim().max(10).default("USD"),
  // Header info (Excel template)
  customer: z.string().trim().max(200).optional(),
  season: z.string().trim().max(50).optional(),
  styleNumber: z.string().trim().max(100).optional(),
  styleName: z.string().trim().max(200).optional(),
  costedQty: z.string().trim().max(200).optional(),
  finishWeight: z.string().trim().max(50).optional(),
  protoVersion: z.string().trim().max(50).optional(),
  // Structured line items (Excel template)
  yarnLines: z.array(cbdLineItemSchema).optional(),
  fabricLines: z.array(cbdLineItemSchema).optional(),
  trimLines: z.array(cbdLineItemSchema).optional(),
  knittingLines: z.array(cbdLineItemSchema).optional(),
  operationsLines: z.array(cbdLineItemSchema).optional(),
  standardPackagingCost: optionalNumber,
  specialPackagingCost: optionalNumber,
  profitCost: optionalNumber,
  yarnNotes: z.string().trim().max(5000).optional(),
  operationsNotes: z.string().trim().max(5000).optional(),
  packagingNotes: z.string().trim().max(5000).optional(),
  overheadNotes: z.string().trim().max(5000).optional(),
  // Legacy fields
  laborCost: optionalNumber,
  overheadCost: optionalNumber,
  profitMargin: optionalPercent,
  moq: optionalInt,
  leadTimeDays: optionalInt,
  materialBufferPercent: optionalPercent,
  packagingCost: optionalNumber,
  testingCost: optionalNumber,
  brandNominatedItems: z.string().trim().max(500).optional(),
  m88Packaging: z.string().trim().max(500).optional(),
  yarnType: z.string().trim().max(100).optional(),
  knitType: z.string().trim().max(100).optional(),
  machineType: z.string().trim().max(100).optional(),
  construction: z.string().trim().max(100).optional(),
  knittingTime: optionalNumber,
  productCategory: z.string().trim().max(100).optional(),
  costingLearning: z.string().trim().max(2000).optional(),
  recurringIssueTags: z.string().trim().max(500).optional(),
  notes: notesSchema,
  freightCost: optionalNumber,
  dutyRate: optionalPercent,
  insuranceCost: optionalNumber,
  customsClearanceCost: optionalNumber,
  inlandTransportCost: optionalNumber,
  // Deprecated factory inputs. PBD selling-price markups are accepted only by
  // /api/costing/requests/[id]/pricing after Costing review.
  wholesaleMarkup: optionalNumber,
  retailMarkup: optionalNumber,
  lines: z.array(z.object({
    bomLineId: z.string().uuid().optional(),
    materialName: z.preprocess((val) => {
      if (val === null || val === undefined) return "";
      return String(val).trim();
    }, z.string().min(1).max(200)),
    unitCost: optionalNumber,
    consumption: optionalNumber,
    uom: optionalString,
    totalCost: optionalNumber,
    currency: optionalString
  })).default([])
});

export const chatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  requestId: z.string().uuid().optional(),
  styleNumber: z.string().trim().max(50).optional()
});

// Optional attribute string: tolerates null/undefined (form fields and JSON
// clients commonly send null for a missing attribute) and trims strings.
// Non-string junk (objects/arrays) is passed through so Zod rejects it.
const optionalAttrString = z.preprocess((val) => {
  if (val === null || val === undefined) return undefined;
  return typeof val === "string" ? val.trim() : val;
}, z.string().trim().max(100).optional());

export const shouldCostSchema = z.object({
  yarnType: optionalAttrString,
  knitType: optionalAttrString,
  machineType: optionalAttrString,
  construction: optionalAttrString,
  productCategory: optionalAttrString,
  factoryName: optionalAttrString,
  actualQuoteTotal: optionalNumber,
  currency: z.preprocess((val) => {
    if (val === null || val === undefined) return undefined;
    return String(val).trim();
  }, z.string().trim().max(10).default("USD"))
});
