import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitize, findModuleConstArrays } from "./helpers/source-scan";
import {
  phaseOneStatuses,
  internalReviewStatuses,
  factoryActionableStatuses,
  factoryHiddenStatuses,
  activeStatuses,
  terminalStatuses
} from "../src/lib/workflow/status";
import { allRoles } from "../src/lib/auth/roles";
import { validTransitions } from "../src/lib/costing/actions";
import { CUSTOMER_STATUSES } from "../src/lib/costing/customer-status";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary choke-point guard.
//
// The status/role/action/customer-status vocabularies each have exactly one
// canonical owner:
//   status          — src/lib/workflow/status.ts
//   role            — src/lib/auth/roles.ts
//   action          — src/lib/costing/actions.ts (the `validTransitions` keys)
//   customer-status — src/lib/costing/customer-status.ts
//
// KNOWN_STATUSES in src/lib/costing/requests.ts was a second copy of the
// status list that drifted from the owner, and aging/escalation/sla-report/
// reporting each hand-wrote their own active/internal/terminal subsets. A
// vocabulary declared in two places drifts silently — one file gains a status,
// another doesn't, and no compiler or test notices until behavior diverges.
//
// This guard scans src/lib for module-level string arrays that substantially
// reproduce one of the canonical vocabularies and fails unless the declaring
// file is tied to the canonical module — either by importing a VALUE from it
// (arrays built from / referencing the canonical exports) or by annotating
// the array with the canonical TYPE (CostingStatus / UserRole), which locks
// the elements to the canonical union at compile time.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_VOCABULARY = new Set<string>([
  ...phaseOneStatuses,
  ...internalReviewStatuses,
  ...factoryActionableStatuses,
  ...factoryHiddenStatuses,
  ...activeStatuses,
  ...terminalStatuses,
  "under_review"
]);
const ROLE_VOCABULARY = new Set<string>(allRoles);
const ACTION_VOCABULARY = new Set<string>(Object.keys(validTransitions));
const CUSTOMER_STATUS_VOCABULARY = new Set<string>(CUSTOMER_STATUSES);
const VOCABULARIES: {
  name: string;
  values: Set<string>;
  /** Canonical export names that tie a declaration to the owner module. */
  exports: string[];
  typeName: string;
  ownerPath: string;
}[] = [
  {
    name: "status",
    values: STATUS_VOCABULARY,
    exports: [
      "phaseOneStatuses",
      "internalReviewStatuses",
      "factoryActionableStatuses",
      "factoryHiddenStatuses",
      "activeStatuses",
      "terminalStatuses"
    ],
    typeName: "CostingStatus",
    ownerPath: "src/lib/workflow/status.ts"
  },
  {
    name: "role",
    values: ROLE_VOCABULARY,
    exports: ["allRoles"],
    typeName: "UserRole",
    ownerPath: "src/lib/auth/roles.ts"
  },
  {
    name: "action",
    values: ACTION_VOCABULARY,
    exports: ["validTransitions"],
    typeName: "", // actions have no canonical type export — a canonical export name is required
    ownerPath: "src/lib/costing/actions.ts"
  },
  {
    name: "customer-status",
    values: CUSTOMER_STATUS_VOCABULARY,
    exports: ["CUSTOMER_STATUSES"],
    typeName: "CustomerStatus",
    ownerPath: "src/lib/costing/customer-status.ts"
  }
];

const SCAN_DIR = "src/lib";
const norm = (p: string) => p.replace(/\\/g, "/");
// The canonical owner modules define their own vocabulary; nothing to import there.
const OWNER_FILES = new Set([
  norm(join("src", "lib", "workflow", "status.ts")),
  norm(join("src", "lib", "auth", "roles.ts")),
  norm(join("src", "lib", "costing", "actions.ts")),
  norm(join("src", "lib", "costing", "customer-status.ts"))
]);

function vocabForElements(elements: string[], arrayExpr: string): (typeof VOCABULARIES)[number] | null {
  // Skip arrays that are not plain string lists — object records (e.g. mock
  // request data whose rows carry a status FIELD) contain vocabulary strings
  // as values without declaring the vocabulary itself.
  if (arrayExpr.includes("{")) return null;
  const n = elements.length;
  if (n < 2) return null;
  for (const vocab of VOCABULARIES) {
    const matches = elements.filter((el) => vocab.values.has(el)).length;
    // Substantially reproduces the vocabulary (not a single incidental match).
    if (matches >= 2 && matches / n >= 0.75) return vocab;
  }
  return null;
}

// A declaration is tied to the canonical module when its INITIALIZER references
// a canonical export (e.g. `const X = activeStatuses` / `[...phaseOneStatuses]`)
// or its type annotation uses the canonical type (CostingStatus / UserRole). A
// bare literal array is never tied, regardless of what else the file imports.
function declTiedTo(declaration: string, exports: string[], typeName: string): boolean {
  for (const name of exports) {
    if (new RegExp(`(^|[^A-Za-z0-9_$])${name}([^A-Za-z0-9_$]|$)`).test(declaration)) return true;
  }
  if (typeName && declaration.includes(typeName)) return true;
  return false;
}

/**
 * Every file this guard inspects — one owner for "what is scanned", so the
 * canary below and the verdict above can never disagree about the input.
 */
export function scanFiles(): string[] {
  const root = join(process.cwd(), SCAN_DIR);
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(root, name));
}

function violations(): string[] {
  const files = scanFiles();

  const bad: string[] = [];
  for (const file of files) {
    if (OWNER_FILES.has(file.replace(process.cwd() + "/", "").replace(/\\/g, "/"))) continue;
    const text = readFileSync(file, "utf8");
    const { code, inString } = sanitize(text);
    const decls = findModuleConstArrays(code, inString);
    for (const decl of decls) {
      const vocab = vocabForElements(decl.elements, decl.arrayExpr);
      if (!vocab) continue;
      // Tied to the canonical module: the initializer references a canonical
      // export, or the array is annotated with the canonical type.
      if (declTiedTo(decl.declaration, vocab.exports, vocab.typeName)) continue;
      const relative = norm(file.replace(norm(process.cwd()) + "/", ""));
      bad.push(
        `${relative}:${decl.line} \`${decl.name}\` re-declares ${vocab.name} values ` +
          `(${decl.elements.slice(0, 4).join(", ")}…) without importing the canonical ` +
          `${vocab.name} module (${vocab.ownerPath})`
      );
    }
  }
  return bad;
}

describe("vocabulary choke point", () => {
  it("recognizes each canonical vocabulary", () => {
    expect(vocabForElements(["draft", "approved"], '"draft", "approved"')?.name).toBe("status");
    expect(vocabForElements(["pbd", "factory"], '"pbd", "factory"')?.name).toBe("role");
    expect(vocabForElements(["approve", "reject"], '"approve", "reject"')?.name).toBe("action");
    expect(vocabForElements(["alpha", "beta"], '"alpha", "beta"')).toBeNull();
    // Customer statuses are their own vocabulary with their own owner.
    expect(vocabForElements(["not_submitted", "sent_to_customer", "closed"], '"not_submitted"')?.name).toBe("customer-status");
    // Object records carry status FIELD values without declaring the vocabulary.
    expect(vocabForElements(["draft", "CR-1"], '{ status: "draft" }')).toBeNull();
  });

  it("requires module ties for vocabulary arrays (canonical export or type annotation)", () => {
    const STATUS_EXPORTS = ["activeStatuses"];
    expect(declTiedTo("const ACTIVE = activeStatuses;", STATUS_EXPORTS, "CostingStatus")).toBe(true);
    expect(declTiedTo("const TRACKED: CostingStatus[] = [\"draft\"];", STATUS_EXPORTS, "CostingStatus")).toBe(true);
    expect(declTiedTo("const ACTIVE = [\"draft\", \"approved\"];", STATUS_EXPORTS, "CostingStatus")).toBe(false);
    expect(declTiedTo("const X = otherStatuses;", STATUS_EXPORTS, "CostingStatus")).toBe(false);
  });

  // A scan that finds nothing reports no violations, so the verdict below needs
  // an input floor to mean anything — the same defence deploy-config and
  // migrations-manifest already carry, and the one the fuzz-table guard lacked.
  it("scans a real source tree before the verdict is trusted", () => {
    const files = scanFiles();
    expect(files.length, "the scan found almost no files — it is not looking at the source").toBeGreaterThan(50);
    expect(files.every((file) => file.endsWith(".ts"))).toBe(true);
    // The canonical owner itself must be inside the scan, or the guard would
    // report a clean tree while exempting the file it exists to police.
    expect(files.some((file) => file.includes(join("workflow", "status.ts"))), "status.ts missing from the scan").toBe(true);
  });

  it("flags no vocabulary re-declarations in the current source", () => {
    const bad = violations();
    expect(
      bad,
      "module-level status/role/action arrays must come from their canonical module — fix the flagged declarations:\n  " +
        bad.join("\n  ")
    ).toEqual([]);
  });
});