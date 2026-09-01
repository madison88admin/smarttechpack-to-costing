import type { CbdMaterialInput, SubmitCbdInput } from "./cbd";

export type ValidationIssue = {
  severity: "error" | "warning" | "info";
  ruleCode: string;
  message: string;
  fieldPath?: string;
};

export function validateFactoryCbd(input: SubmitCbdInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!input.currency?.trim()) {
    issues.push({
      severity: "error",
      ruleCode: "missing_currency",
      message: "Currency is required before PBD review.",
      fieldPath: "currency"
    });
  }

  if (parseNumber(input.laborCost) === null) {
    issues.push({
      severity: "warning",
      ruleCode: "missing_labor_cost",
      message: "Labor cost is missing.",
      fieldPath: "laborCost"
    });
  }

  if (parseNumber(input.overheadCost) === null) {
    issues.push({
      severity: "warning",
      ruleCode: "missing_overhead_cost",
      message: "Overhead cost is missing.",
      fieldPath: "overheadCost"
    });
  }

  [
    ["moq", input.moq, "MOQ is missing."],
    ["leadTimeDays", input.leadTimeDays, "Lead time is missing."],
    ["materialBufferPercent", input.materialBufferPercent, "Material buffer is missing."],
    ["packagingCost", input.packagingCost, "Packaging cost is missing."],
    ["testingCost", input.testingCost, "Testing cost is missing."]
  ].forEach(([fieldPath, value, message]) => {
    if (parseNumber(value) === null) {
      issues.push({
        severity: "warning",
        ruleCode: `missing_${fieldPath}`,
        message: String(message),
        fieldPath: String(fieldPath)
      });
    }
  });

  [
    ["brandNominatedItems", input.brandNominatedItems, "Brand-nominated items were not confirmed."],
    ["m88Packaging", input.m88Packaging, "M88 packaging details are missing."],
    ["yarnType", input.yarnType, "Yarn type is missing for benchmark matching."],
    ["knitType", input.knitType, "Knit type is missing for benchmark matching."],
    ["machineType", input.machineType, "Machine type is missing for benchmark matching."]
  ].forEach(([fieldPath, value, message]) => {
    if (typeof value !== "string" || !value.trim()) {
      issues.push({
        severity: "warning",
        ruleCode: `missing_${fieldPath}`,
        message: String(message),
        fieldPath: String(fieldPath)
      });
    }
  });

  if (!input.lines.length) {
    issues.push({
      severity: "warning",
      ruleCode: "no_material_lines",
      message: "No material lines were submitted with this CBD.",
      fieldPath: "lines"
    });
  }

  input.lines.forEach((line, index) => {
    validateLine(line, index, issues);
  });

  return issues;
}

export function validateBenchmarkVariance(input: {
  currentTotal: number | null;
  historicalAverage: number | null;
  sampleSize: number;
  variancePercent: number | null;
  thresholdPercent?: number;
  convertedCount?: number;
  convertedFrom?: string[];
}): ValidationIssue[] {
  const threshold = input.thresholdPercent ?? 15;

  if (
    input.currentTotal === null ||
    input.historicalAverage === null ||
    input.variancePercent === null ||
    input.sampleSize === 0
  ) {
    return [];
  }

  // Note when the historical average includes records converted from other currencies
  const conversionNote = input.convertedCount
    ? ` (average includes ${input.convertedCount} record(s) converted from ${(input.convertedFrom ?? []).join(", ")})`
    : "";

  if (input.variancePercent > threshold) {
    return [
      {
        severity: "warning",
        ruleCode: "high_historical_variance",
        message: `CBD total is ${input.variancePercent.toFixed(1)}% above historical average.${conversionNote}`,
        fieldPath: "benchmark.currentTotal"
      }
    ];
  }

  if (input.variancePercent < -threshold) {
    return [
      {
        severity: "info",
        ruleCode: "low_historical_variance",
        message: `CBD total is ${Math.abs(input.variancePercent).toFixed(1)}% below historical average.${conversionNote}`,
        fieldPath: "benchmark.currentTotal"
      }
    ];
  }

  return [];
}

function validateLine(line: CbdMaterialInput, index: number, issues: ValidationIssue[]) {
  const path = `lines.${index}`;
  const unitCost = parseNumber(line.unitCost);
  const consumption = parseNumber(line.consumption);

  if (!line.materialName?.trim()) {
    issues.push({
      severity: "error",
      ruleCode: "missing_material_name",
      message: `Material line ${index + 1} is missing a material name.`,
      fieldPath: `${path}.materialName`
    });
  }

  if (unitCost === null) {
    issues.push({
      severity: "error",
      ruleCode: "missing_unit_cost",
      message: `${line.materialName || `Material line ${index + 1}`} is missing unit cost.`,
      fieldPath: `${path}.unitCost`
    });
  } else if (unitCost <= 0) {
    issues.push({
      severity: "error",
      ruleCode: "invalid_unit_cost",
      message: `${line.materialName || `Material line ${index + 1}`} has zero or negative unit cost.`,
      fieldPath: `${path}.unitCost`
    });
  }

  if (consumption !== null && consumption < 0) {
    issues.push({
      severity: "error",
      ruleCode: "invalid_consumption",
      message: `${line.materialName || `Material line ${index + 1}`} has negative consumption.`,
      fieldPath: `${path}.consumption`
    });
  }
}

export function hasBlockingIssues(issues: ValidationIssue[]) {
  return issues.some((issue) => issue.severity === "error");
}

function parseNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;

  const parsed = Number(value.replace(/,/g, ""));

  return Number.isFinite(parsed) ? parsed : null;
}
