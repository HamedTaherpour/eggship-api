# Pricing

Durable boundaries for Product current price and immutable price history. Field-level contracts belong in OpenAPI and Prisma; this file records ownership and lifecycle rules that must not drift.

## Owned resources

| Resource        | Module                 | Public | Admin manage                                                                                                |
| --------------- | ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `Product.price` | `src/modules/products` | read   | via Admin Product PATCH (`CATALOG_MANAGE`) **or** dedicated Admin pricing route (`DISCOUNT_MANAGE`, PRC-04) |
| `PriceHistory`  | `src/modules/pricing`  | none   | read via Admin pricing API (`DISCOUNT_READ`, PRC-04)                                                        |
| `Discount`      | `src/modules/pricing`  | none   | Admin discount APIs (`DISCOUNT_READ` / `DISCOUNT_MANAGE`, PRC-04)                                           |

## Current price vs history (PRC-01)

- **Current price** stays on `Product.price` as integer **Toman** ([ADR 0010](../docs/adr/0010-integer-toman-money.md)). Storefront and Admin catalog reads use this column — not a history scan.
- **PriceHistory** is append-only audit data for each **actual** price change after product creation. Rows are immutable; repositories expose append/list/count only — no update/delete API.
- Product **creation** sets the initial price without a history row. Only subsequent committed changes append history.
- **No-op updates** (`newPrice === current price`) must not write history or mutate `Product.price`.
- **Server authority:** `oldPrice` is always read from the locked current `Product.price` inside the transaction. Clients never supply `oldPrice`.
- **Actor:** Admin price changes record `actorType = ADMIN` and `actorId` from the authenticated Admin principal (session subject). Actor is never accepted from the request body.
- **Timestamps:** `PriceHistory.createdAt` is PostgreSQL `timestamptz(3)` default `now()` — the UTC instant the change commits. There is no separate “effective at” dimension in PRC-01.
- **Reason:** not modeled in PRC-01; add only when a later approved task requires it.
- **Transactions:** `Product.price` update and `PriceHistory` append occur in one PostgreSQL transaction. Failure on either side rolls back both.
- **Concurrency:** price changes lock the Product row (`SELECT … FOR UPDATE`) so concurrent updates serialize and history chains stay coherent (`oldPrice` of row N+1 equals `newPrice` of row N).
- **Deletion:** `PriceHistory.productId` uses `ON DELETE RESTRICT` — Products with history cannot be hard-deleted.
- **Validation:** integer Toman only; `oldPrice > 0`, `newPrice > 0`, bounded by the same int4 policy as `Product.price`.

## Catalog boundary

- **Catalog (`products`)** owns Product identity, Category link, activation, and the current price column.
- **Pricing (`pricing`)** owns price-change semantics and `PriceHistory` persistence.
- Admin Product PATCH remains the HTTP entry for price changes in PRC-01, but application code routes price mutations through `PricingService` — not direct repository price writes.
- Do not implement calculation engines or public pricing APIs here (PRC-03–PRC-05).

## Discount model and lifecycle (PRC-02)

- **`Discount`** lives in `src/modules/pricing` — separate from append-only **`PriceHistory`**.
- **Types:** `PERCENT` (whole-number `percentValue` 1–100) and `FIXED` (`fixedAmount` integer Toman). No floating-point money; type-specific columns are mutually exclusive (DB CHECK + application validation).
- **Targets:** `ORDER` (no FK), `PRODUCT` (`productId`), `CATEGORY` (`categoryId`). Target FK columns are enforced by CHECK constraints; Product/Category references use `ON DELETE RESTRICT`.
- **Lifecycle:** explicit `isActive` flag — prefer deactivation over hard delete. Optional UTC window `startsAt` / `endsAt` (timestamptz); when both are set, `startsAt < endsAt`. Rows may remain `isActive = true` after `endsAt` until an admin deactivates or updates them; **expired-but-active rows are not applicable** (`isPotentiallyApplicable` requires both `isActive` and an in-window instant). PRC-03 owns calculation semantics.
- **`precedence`:** opaque integer input stored for PRC-03 ordering. No stacking, overlap, or eligibility rules in PRC-02.
- **Admin writes only:** `DiscountService` validates server-side; HTTP Admin CRUD/list is PRC-04 (`DISCOUNT_READ` / `DISCOUNT_MANAGE`).
- **HTTP lifecycle (PRC-04):** `GET/POST/PATCH admin/discounts`, `POST admin/discounts/:id/activate|deactivate`. PATCH excludes `isActive` — use explicit lifecycle routes. No hard delete.
- **Out of scope in PRC-02:** promo codes, redemption counters, minimum order amount, max discount cap, usage limits, calculation, Order discount snapshots, and public discount APIs.

## Discount calculation (PRC-03)

Pure domain calculation in `src/modules/pricing/domain/discount-calculation.ts`. No HTTP, no DB mutation, no Redis/cache authority, and no promo-code redemption.

### Calculation contract

- **Persistence-neutral:** callers supply candidate `DiscountRecord` rows and a pricing snapshot instant (`evaluatedAt`). The engine returns base/discount/final amounts plus immutable applied-discount metadata for future Order snapshotting (ORD-03 / PRC-05).
- **Server authority:** `Product.price` is the unit-price authority; `PriceHistory` is historical only. Line bases derive from server `unitPrice × quantity`. PRODUCT/CATEGORY targeting matches server `productId` / `categoryId` from catalog — never client-supplied category or price.
- **Snapshot instant:** eligibility uses `evaluatedAt` with `isPotentiallyApplicable` (`isActive` plus optional UTC window). Callers that load discounts from PostgreSQL must pass the same instant they used for catalog/pricing reads so concurrent price or discount changes have an explicit evaluation point (PRC-05 / ORD-03 orchestration).

### Eligibility

A discount is eligible when all hold at `evaluatedAt`:

1. `isActive === true`
2. Inside optional window: `startsAt` null or `evaluatedAt >= startsAt`; `endsAt` null or `evaluatedAt < endsAt` (same semantics as PRC-02 `isWithinActivationWindow`)
3. Target-compatible with calculation scope and server line context (see targeting below)
4. Persisted type/value/target shape passes existing PRC-02 normalizers — malformed rows are **skipped**, not applied

### Targeting

| Scope   | Evaluates targets     | Context required                                    |
| ------- | --------------------- | --------------------------------------------------- |
| `LINE`  | `PRODUCT`, `CATEGORY` | Server `productId`, `categoryId` on the priced line |
| `ORDER` | `ORDER` only          | Order subtotal as `baseAmount`                      |

`ORDER` discounts do not apply at `LINE` scope; `PRODUCT` / `CATEGORY` discounts do not apply at `ORDER` scope.

### Stacking (V1)

**Single winner per calculation invocation.** No multi-discount stacking, compounding, or silent combination. PRC-05 / ORD-03 may invoke separate LINE and ORDER calculations, but each invocation applies at most one discount.

### Precedence and tie-break

Among eligible discounts for one invocation:

1. **Higher `precedence` wins** (larger integer beats smaller).
2. **Equal precedence:** ascending discount `id` (UUID string order) wins — stable, DB-order-independent tie-break.

### Rounding and money safety

- Integer Toman only; bigint arithmetic for amounts that may exceed int4 (order subtotals).
- **PERCENT:** `discountAmount = floor(baseAmount × percentValue ÷ 100)` via bigint integer division (truncate toward zero).
- **FIXED:** `discountAmount = min(fixedAmount, baseAmount)`.
- **Final:** `finalAmount = baseAmount − discountAmount` (never negative).
- Bounds: `0 … DISCOUNT_MONEY_MAX_TOMAN` (PostgreSQL BIGINT max; same as order money per [ADR 0013](../docs/adr/0013-order-historical-snapshots.md), [ADR 0010](../docs/adr/0010-integer-toman-money.md)).

### Out of scope in PRC-03

Promo codes, usage limits, minimum-order thresholds, max-discount caps, HTTP/public APIs, Order persistence, payment concepts, and multi-discount stacking beyond the single-winner rule above.

## Orders boundary

- Orders snapshot title and unit price at creation (ORD-01). Changing current price or appending history must not mutate existing Order lines.

## Permissions

- **Price changes:** Admin Product PATCH (`CATALOG_MANAGE`) remains supported for catalog workflows. PRC-04 adds `PATCH admin/pricing/products/:productId/price` under `DISCOUNT_MANAGE` with the same `PricingService` semantics (atomic history append, no-op when unchanged, server-side actor).
- **Price history read:** `GET admin/pricing/products/:productId/price-history` requires `DISCOUNT_READ`. Append-only — no update/delete HTTP.
- **Discount admin:** list/read routes require `DISCOUNT_READ`; create/update/activate/deactivate require `DISCOUNT_MANAGE`. Customer (`USER`) principals receive `403`.

## Admin HTTP surface (PRC-04)

| Method  | Path                                              | Permission        | Notes                                                                           |
| ------- | ------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `GET`   | `admin/pricing/products/:productId/price-history` | `DISCOUNT_READ`   | Paginated; newest first (`createdAt desc`, `id desc` tie-break)                 |
| `PATCH` | `admin/pricing/products/:productId/price`         | `DISCOUNT_MANAGE` | Body: `{ price }` integer Toman; actor from Admin session                       |
| `GET`   | `admin/discounts`                                 | `DISCOUNT_READ`   | Pagination, `search` (name), filters `isActive`/`type`/`target`, sort allowlist |
| `POST`  | `admin/discounts`                                 | `DISCOUNT_MANAGE` | Create with strict DTO validation                                               |
| `PATCH` | `admin/discounts/:id`                             | `DISCOUNT_MANAGE` | Update allowlist; no `isActive`                                                 |
| `POST`  | `admin/discounts/:id/activate`                    | `DISCOUNT_MANAGE` | Sets `isActive = true`                                                          |
| `POST`  | `admin/discounts/:id/deactivate`                  | `DISCOUNT_MANAGE` | Sets `isActive = false`                                                         |

Promo-banner persistence/API is **not** implemented in PRC-04 — no evidenced legacy requirements in-repo (see roadmap unresolved decisions).
