# Smart TP-to-Costing Short Process

## Goal

Reduce manual costing cycles by pulling style, BOM, PO, and MPO data from NextGen, then letting factories only fill the missing cost details.

## Flow

1. User searches style, PO, or MPO in the costing app.
2. Backend proxy logs in to NextGen using server-side credentials.
3. App fetches product, option, BOM, PO, and MPO data from NextGen.
4. System creates a costing request with prefilled style and material lines.
5. Factory reviews the request and submits CBD values.
6. Validation checks missing fields, abnormal costs, and benchmark variance.
7. Clean requests go to fast-track PBD approval.
8. Requests with issues generate one consolidated clarification.
9. Approved CBD is saved as historical costing data for future recommendations.

## Backend-Only NextGen Proxy

Frontend must call local proxy endpoints only:

```txt
GET /api/product/search?q=M8819347
GET /api/product/:entityId
GET /api/product/:entityId/options
GET /api/product/:entityId/bom

GET /api/nextgen/bom/search?styleNumber=M88118568
GET /api/nextgen/bom/search?materialName=Fleece
GET /api/nextgen/bom/search?category=Packaging
GET /api/nextgen/bom/search?entityId=32514
GET /api/nextgen/bom/search?filter=ProductId~eq~32514

GET /api/nextgen/po/search?q=PO123
GET /api/nextgen/po/:id

GET /api/nextgen/mpo/search?q=MPO015868
GET /api/nextgen/mpo/:id
GET /api/nextgen/mpo/:id/lines
GET /api/nextgen/mpo/:id/totals
```

NextGen credentials belong in `.env.local` or VPS secrets only.

Minimum local/VPS environment variables:

```txt
NEXTGEN_BASE_URL=https://nextgen.madison88.com
NEXTGEN_USERNAME=...
NEXTGEN_PASSWORD=...

NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Do not expose `NEXTGEN_PASSWORD` or `SUPABASE_SERVICE_ROLE_KEY` to frontend code.

## Notes From Initial Probe

Login is confirmed working through:

```txt
GET  /Account/Login
POST /Account/Login
```

NextGen returns `FastReactAntiForgeryCookie` and `FastReactAuthentication` cookies after login.

The listed product grid paths returned NextGen not-found responses during the first probe, so endpoint paths are configurable through environment variables such as:

```txt
NEXTGEN_PRODUCT_SEARCH_PATH=/ProductManagerProductsGrid/Read
NEXTGEN_PRODUCT_READ_PATH=/Product/GetById
```

## BOM Endpoint Notes (Confirmed 2026-08-03)

The BOM grid endpoint is `/WhereUsed/ReadProductManagerBoM`. It requires two non-obvious parameters discovered from the Kendo grid config in `/ViewCache/BillOfMaterial`:

- `EntityType=23` — required, otherwise the endpoint returns HTTP 500. This value comes from the grid's `data-fr-option-variants` attribute.
- `filter=ProductId~eq~<id>` — the `productId` body/URL parameter is **ignored** by NextGen. Filtering is done via the Kendo legacy filter syntax on the `ProductId` field.

Without `EntityType=23`, every product returns 500. Without the `filter`, the endpoint returns all 64,530 BOM lines across all products (unfiltered).

All BOM fetch parameters are now configurable via environment variables (see `.env.example`):

```txt
NEXTGEN_BOM_ENTITY_TYPE=23
NEXTGEN_BOM_FILTER_FIELD=ProductId
NEXTGEN_BOM_FILTER_OPERATOR=eq
NEXTGEN_BOM_PAGE_SIZE=200
NEXTGEN_BOM_USER_AREA_CLAIM=FullAccess
NEXTGEN_BOM_SHOW_TABS=False
NEXTGEN_BOM_VIEWCACHE_PATH=/ViewCache/BillOfMaterial
```

The flexible BOM search endpoint `/api/nextgen/bom/search` accepts any of these query params (at least one required):

- `entityId` — filter by NextGen ProductId (uses `eq` operator)
- `styleNumber` or `style` — filter by ProductName (uses `contains` operator)
- `materialName` or `material` — filter by MaterialName (uses `contains` operator)
- `category` — filter by BoMItemCategoryName (uses `contains` operator)
- `commodity` — filter by CommodityTypeName (uses `contains` operator)
- `materialId` — filter by MaterialId (uses `eq` operator)
- `filter` — raw Kendo filter string override (e.g. `ProductId~eq~32514`)
- `pageSize` — max 500, default 200
- `skip` — pagination offset

The proxy (`src/lib/nextgen/client.ts`) now auto-retries once on HTTP 401 by invalidating the cached session and re-logging in. This handles the case where NextGen invalidates a session before the 20-minute TTL expires.

## VPS Session/401 Troubleshooting

If `/api/nextgen/health` returns 401 or `authenticated: false` on the VPS:

1. Restart the app container to clear the in-memory session cache:

   ```bash
   docker restart smart-tp-costing
   curl http://127.0.0.1:3110/api/nextgen/health
   ```

2. If still failing, verify the VPS `.env.costing` NextGen credentials match a known-working set:

   ```bash
   grep NEXTGEN_ deploy/.env.costing
   ```

3. Check the VPS IP is not blocked by NextGen's firewall/WAF — test from the VPS itself:

   ```bash
   curl -k -I https://nextgen.madison88.com/Account/Login
   ```

4. Check app logs for the exact upstream status:

   ```bash
   docker logs --tail 50 smart-tp-costing
   ```
