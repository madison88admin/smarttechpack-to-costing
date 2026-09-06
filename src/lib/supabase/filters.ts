// PostgREST filter hardening — shared choke point for user-derived values
// reaching .eq() / .ilike() / interpolated .or() filters.
//
// Verified against the live PostgREST behind the VPS kong:
//   - Unquoted values containing spaces, commas, quotes, parens, or semicolons
//     are treated as literals and match correctly (200, fast).
//   - Double-quoting a value is NOT stripped by this server — `col=eq."x"` is
//     compared as the literal text `"x"` (quotes included): silent no-match on
//     text columns, and a 22P02 cast error on uuid columns. Quoting must
//     therefore never be applied to filter values.
//   - A comparison tautology after a logical keyword — `x OR 1=1`, `x OR x=x`,
//     `x AND 1=1` — hangs the request indefinitely, quoted or not. `=` is the
//     trigger operator (`1>0`, `1<>2`, `x OR 1=2` are harmless). Filter values
//     in this domain never legitimately contain `=`, so it is stripped at the
//     boundary.
//   - Values longer than ~500 chars blow up the request URI (Kong: "URI too
//     long"), so they are truncated before they reach PostgREST.
const TAUTOLOGY_EQUALS = /=/g;

// Filter values longer than this are truncated before they reach PostgREST:
// the query string our client sends is built from the value, and Kong rejects
// oversized request URIs with a hard error ("URI too long"). No legitimate
// search term in this domain approaches this length.
export const MAX_FILTER_LENGTH = 500;

function neutralize(value: string): string {
  const truncated = value.length > MAX_FILTER_LENGTH ? value.slice(0, MAX_FILTER_LENGTH) : value;
  return truncated.replace(TAUTOLOGY_EQUALS, "");
}

/** Neutralizes a raw value for .eq()/interpolated filters — `=`-tautologies
 * stripped, truncated — WITHOUT quoting (this server compares quoted values
 * literally, breaking matches). */
export function pgrestValue(value: string): string {
  return neutralize(value);
}

/** Builds a `%value%` ilike pattern from a raw user term (no quoting). */
export function pgrestLike(value: string): string {
  return neutralize(`%${value}%`);
}

/**
 * Builds a comma-joined PostgREST `.or()` filter searching several fields for
 * one user term. Values are neutralized (`=`-tautology strip + truncate) and
 * DOUBLE-QUOTED: verified live against this server's PostgREST, an unquoted
 * comma inside `.or()` is parsed as filter grammar (PGRST100 → 400/500), while
 * a quoted value is parsed as a literal and matches correctly (`"*7*"` returns
 * the same rows as `*7*`). `.eq()` values must NOT be quoted (compared
 * literally here), but `.or()` grammar quotes ARE stripped — the two forms are
 * handled differently on purpose. Embedded double quotes are stripped from the
 * term so they cannot break the quoted-string grammar; no legitimate search
 * term in this domain contains one.
 */
export function pgrestOrTerms(fields: readonly string[], value: string): string {
  const term = neutralize(value).replace(/"/g, "");
  return fields.map((field) => `${field}.ilike."%${term}%"`).join(",");
}