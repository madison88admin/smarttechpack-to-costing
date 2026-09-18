# Module ownership

Where each piece of state lives, so a change lands in one obvious place. Pinned by
`tests/vocabulary-chokepoint.test.ts` (vocabularies), `tests/historical-facets-route.test.ts`
(historical reads), `tests/migrations-manifest.test.ts` (deploy manifest).

## Caches — `src/lib/cache/stale-while-revalidate.ts`

Two primitives, one owner. Callers never hand-roll a TTL map.

| Primitive | Use | Callers |
|---|---|---|
| `createTtlMap(ttlMs)` | memoize an upstream response by key | NextGen GET responses, product images (`src/lib/nextgen/client.ts`) |
| `createStaleWhileRevalidateCache({ ttlMs, build, snapshot? })` | one expensive derived value: serve stale while refreshing behind the caller, coalesce concurrent builds, wait only when nothing has ever been built | NextGen filter directory, historical facet values |

`snapshot` is the optional durable layer (`load` / `save`); the cache never knows where it
lives. A snapshot older than the TTL seeds an already-stale entry, so the first request
after a deploy serves instantly and refreshes in the background.

## NextGen directory

| Concern | Owner |
|---|---|
| ERP scan + value normalization (products, PO lines) | `src/lib/nextgen/filter-options.ts` |
| Durable snapshot row (`nextgen_filter_option_cache`, migration 020) | `src/lib/nextgen/filter-options-snapshot.ts` |

## Historical costing pool

`src/lib/costing/history.ts` owns every read of `historical_costings`: the shared column
list, `HISTORICAL_FACET_COLUMNS`, `listHistoricalCostings`, `listHistoricalFacetValues`,
like-style scoring (`findLikeStyles`, `LIKE_STYLE_WEIGHTS`, `matchConfidence`) and the
benchmarks. Routes under `src/app/api/historical/*` and the history exports are thin —
role check, cache, delegate — and must not query the table themselves.

Import identity is the same owner: `historicalImportKey` (the ERP record a row came from,
`id`/`Id` in the payload, content only for exports without an id),
`listExistingHistoricalImportKeys` and `dedupeHistoricalImports` are what both writers —
`api/admin/import-historical` (Data Bank export) and `api/admin/sync-nextgen-historical`
(product grid) — call before inserting, so re-running an import cannot add a second row for
a record the pool already holds. `historicalDedupKey` (style + factory, in
`src/lib/nextgen/historical.ts`) is only the *match* key `backfill-nextgen-times` uses to
find the row a new SMV belongs to; it is not an identity and must not be used to decide
whether something is new.

## Vocabularies and access rules — `src/lib/auth/roles.ts`

Statuses (`src/lib/workflow/status.ts`), actions (`src/lib/costing/actions.ts`) and customer
statuses (`src/lib/costing/customer-status.ts`) are single-owner too. Access rules are
predicates, not literals: `canAccessInternalCostData(role)` (everything but Factory) and
`canAccessHistoricalCostData(role)` (that, minus Viewer) for the history and Like Styles
surfaces. Route and page guards call a predicate — re-listing roles in a route is how the
Like Styles search, its exports and the history exports drifted apart.

Factory path confinement is `src/lib/auth/factory-paths.ts`: `src/middleware.ts` imports it
and `tests/factory-path-allowlist.test.ts` executes it, so a path a factory screen calls but
the list forgets fails a test instead of 403-ing a control the user can see (the CBD
wizard's photo panel did exactly that).

## Deploy

`deploy/apply-migrations.sh` applies an explicit ordered manifest as **supabase_admin** (not
`postgres`, which owns only part of `tp_costing`); migrations 012+ are not auto-discovered
(re-running the pre-ledger ones is not safe). Adding a migration means the `.sql` file plus
one `apply_migration <version> <file>` line, and the guard test fails if a file from 012 on is
missing from the list. `deploy/sync-to-vps.sh` is the workstation half (package, ship, run
`deploy/rollout-security.sh` detached, poll, verify); `rollout-security.sh` migrates the new
tree before swapping directories so a failed migration cannot leave a half-deployed app.
