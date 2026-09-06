import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitize, extractArgs, splitTopLevel } from "./helpers/source-scan";

// ─────────────────────────────────────────────────────────────────────────────
// Static choke-point guard for PostgREST filter values.
//
// The discovered regressions (status-filter hang, comma 500, ilike hang,
// tautology hang) all shared one shape: a value derived from user input
// reached `.eq(...)` / `.ilike(...)` / `.or(...)` unquoted, so PostgREST
// parsed it as filter grammar. The shared helpers pgrestValue/pgrestLike/
// pgrestOrTerms (src/lib/supabase/filters.ts) fix that, but they are opt-in
// — nothing stopped a NEW route from bypassing them. This test scans src/lib
// and src/app/api and fails when any filter-verb value argument is a variable
// that is not (a) produced by pgrestValue/pgrestLike/pgrestOrTerms, (b) a literal,
// (c) a route-validated `params.*` id, (d) a DB-derived `.id`/`_id` member
// on an allowlisted root, or (e) a bare identifier on the small allowlist
// below (each entry documented with why it is provably safe).
//
// `.or(...)` filter strings are checked separately: every `${...}`
// interpolation must be wrapped in a pgrest helper.
// ─────────────────────────────────────────────────────────────────────────────

const SCAN_DIRS = ["src/lib", "src/app/api"];

// Bare identifiers allowed without a helper. Each entry is safe because of a
// property this codebase enforces elsewhere, documented here so the entry can
// be challenged when the property changes:
//   id / requestId     — fed exclusively by `[id]` routes that UUID-validate
//                        (validateRequestId) or by session-derived ids
//   fromStatus/toStatus — internal workflow-status constants, never user input
//   knownStatus        — whitelist-checked against phaseOneStatuses (the
//                        canonical status.ts vocabulary) in the same function
//   allowedStatuses    — derived from the role-visibility status constants
const ALLOWED_BARE = new Set(["id", "requestId", "fromStatus", "toStatus", "knownStatus", "allowedStatuses"]);

// Member-expression roots that are provably DB-derived (query results) or
// validated UUID params, so `.id` / `_id` members on them are safe.
const ALLOWED_MEMBER_ROOTS = new Set(["context", "req", "existing", "data", "profile", "input", "latestCbd", "product", "request"]);

const FILTER_VERB = /\b\.(eq|ilike|or|in|not|gt|gte|lt|lte)\s*\(/g;

// ── classification ───────────────────────────────────────────────────────────
function isLiteral(value: string): boolean {
  const t = value.trim();
  if (/^'(?:[^'\\]|\\.)*'$/.test(t) || /^"(?:[^"\\]|\\.)*"$/.test(t)) return true;
  if (/^`[^$`]*`$/.test(t)) return true; // template without interpolations
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(t)) return true;
  return ["true", "false", "null", "undefined"].includes(t);
}

function isHelperCall(value: string): boolean {
  return /^(pgrestValue|pgrestLike|pgrestOrTerms)\s*\(/.test(value.trim());
}

function isParamsMember(value: string): boolean {
  return /^(context|req)\.params\.[A-Za-z_$][\w$]*$/.test(value.trim());
}

function isAllowedMember(value: string): boolean {
  const t = value.trim();
  // e.g. existing.id, profile?.id, req?.product_id — root allowlisted, final
  // segment is an id-shaped member.
  const m = t.match(/^([A-Za-z_$][\w$]*)(?:\?*\.\?*[A-Za-z_$][\w$]*)+$/);
  if (!m) return false;
  if (!ALLOWED_MEMBER_ROOTS.has(m[1])) return false;
  const last = t.match(/\.([A-Za-z_$][\w$]*)$/);
  return !!last && /^(id|\w*_id)$/.test(last[1]);
}

function valueAllowed(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  if (isLiteral(t)) return true;
  if (isHelperCall(t)) return true;
  if (isParamsMember(t)) return true;
  if (isAllowedMember(t)) return true;
  if (/^[A-Za-z_$][\w$]*$/.test(t)) return ALLOWED_BARE.has(t);
  return false;
}

// Every `${...}` interpolation inside a filter-string template must be (or
// contain) a pgrest helper call.
function templateWrapped(template: string): boolean {
  const re = /\$\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(template)) !== null) {
    count++;
    const inner = m[1];
    if (!/pgrest(Value|Like|OrTerms)\s*\(/.test(inner)) return false;
  }
  return count > 0; // a template with interpolations must have wrapped them all
}

// `.in(column, [...])` values are escaped by supabase-js itself (values with
// reserved characters get double-quoted — verified in postgrest-js), so id
// arrays and the `visibleIds.length ? visibleIds : []` shape are safe without
// a helper. Everything else still goes through valueAllowed.
function inAllowed(value: string): boolean {
  const t = value.trim();
  if (t.startsWith("[")) {
    const elems = splitTopLevel(t.slice(1, -1), ",").map((e) => e.trim()).filter(Boolean);
    return elems.length > 0 && elems.every((e) => isLiteral(e) || /pgrest(Value|Like|OrTerms)\s*\(/.test(e));
  }
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*Ids$/.test(t)) return true; // id arrays, client-escaped
  if (/^[A-Za-z_$][\w$]*\.length\s*\?\s*[A-Za-z_$][\w$]*\s*:\s*\[[\s\S]*\]$/.test(t)) return true;
  return valueAllowed(t);
}

function orAllowed(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  if (isLiteral(t)) return true;
  // Direct shared-helper call: pgrestOrTerms builds the whole quoted or()
  // string (neutralize + quote), so the value never reaches PostgREST raw.
  if (/^pgrestOrTerms\s*\(/.test(t)) return true;
  if (t.startsWith("`") && t.endsWith("`")) return templateWrapped(t);
  // `[ ... ].join(",")` builds one filter string from wrapped templates
  if (/^\[[\s\S]*\]\.join\([^)]*\)$/.test(t)) {
    return orAllowed(t.slice(0, t.lastIndexOf("].join")) + "]");
  }
  if (t.startsWith("[") && t.endsWith("]")) {
    const elems = splitTopLevel(t.slice(1, -1), ",").map((e) => e.trim()).filter(Boolean);
    if (elems.length === 0) return false;
    return elems.every((el) => {
      if (isLiteral(el)) return true;
      if (/pgrest(Value|Like|OrTerms)\s*\(/.test(el)) return true;
      if (el.startsWith("`") && el.endsWith("`")) return templateWrapped(el);
      return false;
    });
  }
  return false;
}

type Site = { file: string; line: number; verb: string; args: string };

export function scanFilterSites(dirs: string[] = SCAN_DIRS): Site[] {
  const files = dirs.flatMap((dir) => {
    const root = join(process.cwd(), dir);
    return (readdirSync(root, { recursive: true }) as string[])
      .filter((name) => name.endsWith(".ts"))
      .map((name) => join(root, name));
  });

  const sites: Site[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const { code, inString } = sanitize(text);
    FILTER_VERB.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FILTER_VERB.exec(code)) !== null) {
      if (inString[m.index]) continue;
      const verb = m[1];
      const open = code.indexOf("(", m.index + m[0].length - 1);
      const args = extractArgs(code, open);
      const line = text.slice(0, m.index).split("\n").length;
      sites.push({ file: file.replace(process.cwd() + "/", "").replace(/\\/g, "/"), line, verb, args });
    }
  }
  return sites;
}

function violations(sites: Site[]): string[] {
  const bad: string[] = [];
  for (const site of sites) {
    const args = site.args.trim();
    if (site.verb === "or") {
      if (!orAllowed(args)) bad.push(`${site.file}:${site.line} .or(${args.length > 60 ? args.slice(0, 60) + "…" : args})`);
      continue;
    }
    // value is the last argument for every other verb (.not's third arg too)
    const parts = splitTopLevel(args, ",").map((p) => p.trim());
    const value = parts[parts.length - 1] ?? "";
    if (site.verb === "in") {
      if (!inAllowed(value)) {
        bad.push(`${site.file}:${site.line} .in(${args.length > 60 ? args.slice(0, 60) + "…" : args})`);
      }
      continue;
    }
    if (!valueAllowed(value)) {
      bad.push(`${site.file}:${site.line} .${site.verb}(${args.length > 60 ? args.slice(0, 60) + "…" : args})`);
    }
  }
  return bad;
}

describe("PostgREST filter choke point", () => {
  it("classifies the safe and unsafe shapes correctly", () => {
    expect(valueAllowed('"main"')).toBe(true);
    expect(valueAllowed("true")).toBe(true);
    expect(valueAllowed("opts.severity")).toBe(false);
    expect(valueAllowed("username")).toBe(false);
    expect(valueAllowed("body.requestId")).toBe(false);
    expect(valueAllowed("validated.styleNumber")).toBe(false);
    expect(valueAllowed("context.params.id")).toBe(true);
    expect(valueAllowed("existing.id")).toBe(true);
    expect(valueAllowed("profile?.id")).toBe(true);
    expect(valueAllowed("req?.product_id")).toBe(true);
    expect(valueAllowed("pgrestValue(thing)")).toBe(true);
    expect(valueAllowed("pgrestLike(term)")).toBe(true);
    expect(valueAllowed("pgrestOrTerms([\"a\", \"b\"], term)")).toBe(true);
    expect(valueAllowed("requestId")).toBe(true); // allowlisted, UUID-validated by [id] routes
    expect(valueAllowed("fromStatus")).toBe(true);
    expect(valueAllowed("arbitraryVar")).toBe(false);
    expect(templateWrapped("`a.ilike.${pgrestLike(q)}`")).toBe(true);
    expect(templateWrapped("`a.ilike.${q}`")).toBe(false);
    expect(templateWrapped("`a.ilike.${q},b.ilike.${pgrestLike(q)}`")).toBe(false);
    expect(orAllowed("`a.ilike.${pgrestLike(q)}`")).toBe(true);
    expect(orAllowed("`a.ilike.${q}`")).toBe(false);
    expect(orAllowed('"a.eq.constant"')).toBe(true);
  });

  it("flags no filter sites in the current source (the choke point holds)", () => {
    const bad = violations(scanFilterSites());
    expect(
      bad,
      "user-derived values must reach PostgREST filters only via pgrestValue/pgrestLike — wrap the flagged value:\n  " +
        bad.join("\n  ")
    ).toEqual([]);
  });
});