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
- Do not route order pricing through Product HTTP. Order/create pricing uses `OrderPricingService` (PRC-05).

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

**Single winner per calculation invocation.** No multi-discount stacking, compounding, or silent combination within one scope. PRC-05 composes separate LINE and ORDER invocations under [ADR 0015](../docs/adr/0015-line-then-order-discount-composition.md) (LINE then ORDER on the discounted subtotal).

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

## Order pricing composition (PRC-05)

Server-authoritative order pricing for ORD-03. Application entry: `OrderPricingService.priceOrderLines`. No HTTP, no Order/OrderLine writes, no promo codes, no Redis correctness dependency.

Locked V1 composition is [ADR 0015](../docs/adr/0015-line-then-order-discount-composition.md).

### Input contract

- Callers supply normalized order lines containing only trusted `productId` + `quantity`.
- Duplicate `productId` lines collapse by summing quantities (same V1 policy as ORD-01 / Inventory).
- Clients never supply authoritative `unitPrice`, category, or discount identity.
- One shared `evaluatedAt` for the whole operation (caller-supplied or a single default at service entry — never per-line `new Date()`).

### Authoritative sources

| Fact                    | Source                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Unit price              | Current `Product.price` (not PriceHistory)                                                                                   |
| Product name / category | Current Product row                                                                                                          |
| Sale visibility         | Active Product **and** active Category (CAT-06 / public storefront rule)                                                     |
| Discounts               | Active Discount candidates matching ORDER or the priced PRODUCT/CATEGORY ids; window eligibility via PRC-03 at `evaluatedAt` |

Missing or non-saleable products raise `PRODUCT_NOT_FOUND` (`OrderPricingProductUnavailableError`) without distinguishing hidden vs absent.

### Composition (policy A)

1. Each line: at most one LINE winner (`PRODUCT` / `CATEGORY`) via PRC-03.
2. `grossLineTotal = unitPrice × quantity`; `finalLineTotal = grossLineTotal − lineDiscountAmount`.
3. `subtotalAfterLineDiscounts = Σ finalLineTotal`.
4. At most one ORDER winner against **`subtotalAfterLineDiscounts`** (not pre-discount gross).
5. `total = subtotalAfterLineDiscounts − orderDiscountAmount`.
6. No same-scope stacking; LINE then ORDER cross-scope composition is allowed.
7. Reuses PRC-03 `calculateDiscount` — does not fork percent/fixed/precedence/malformed-skip math.

### Snapshot result (persistence-neutral)

Returned for ORD-03 persistence later. Explicit fields — not a generic JSON blob:

**Per line:** `productId`, `productName`, `categoryId`, `unitPrice`, `quantity`, `discountedQuantity`, `grossLineTotal`, `lineDiscountAmount`, `finalLineTotal`, `appliedLineDiscount` (or null). `discountedQuantity` is the DLU-02 / ADR 0017 snapshot of units that received the LINE discount (`0…quantity`).

**Order:** `grossSubtotal`, `lineDiscountTotal`, `subtotalAfterLineDiscounts`, `orderDiscountAmount`, `total`, `appliedOrderDiscount` (or null), `evaluatedAt`, plus `lifetimeConsumptions` intents for ORD-03 CONSUME.

PRC-05 composes persistence-neutral snapshots. ORD-03 persists discounted amounts, applied-discount evidence, and `discountedQuantity` into explicit columns (`grossLineTotal` / `finalLineTotal`, order aggregates, applied-discount snapshot fields, `pricingEvaluatedAt`) without re-reading mutable Product/Discount state after pricing. Lifetime-cap configuration and usage mutation are owned by DLU-02.

### Reads, transactions, and concurrency

- Batch-load Products (`findPublicByIds`) and Discount candidates (`findCandidatesForOrderPricing`) — no N+1.
- Standalone calls use `TransactionRunner.runSnapshotRead` (PostgreSQL **REPEATABLE READ**) so Product price/name/category and eligible Discounts share one coherent snapshot without broad row locks.
- Optional `tx` joins an outer ORD-03 transaction via `runIn` (inherits caller isolation). **ORD-03 opens create at REPEATABLE READ** (`TransactionRunner.runRepeatableRead`) so Product@S1 and Discount@S1 stay coherent with persistence. Joining a default READ COMMITTED transaction can observe Product@S1 and Discount@S2 under concurrent Admin updates.
- Concurrent Admin price/discount updates must not produce a hybrid mutable view within one pricing attempt; repeated calculation with the same snapshot inputs is deterministic.

### Out of scope in PRC-05

Order HTTP/create, payments, promo codes, and Redis-backed pricing. Lifetime quantity caps follow DLU-01 / ADR 0017 and are implemented in DLU-02 (this module owns partial pricing + usage services; Orders orchestrates create/cancel).

## Orders boundary

- Orders snapshot title and unit price at creation (ORD-01). Changing current price or appending history must not mutate existing Order lines.
- Order-time discount composition and persistence-neutral pricing snapshots are owned by PRC-05 (`OrderPricingService`); ORD-03 persists them.

## Product-discount lifetime customer limit (DLU-01 / ADR 0017; DLU-02)

Accepted architecture: [ADR 0017](../docs/adr/0017-discount-lifetime-quantity-limit.md). Implemented in DLU-02.

### Scope

- Optional `maxQuantityPerCustomer` applies **only** to `DiscountTarget.PRODUCT` in V1. `null` means unlimited and preserves existing Discount behavior.
- `CATEGORY` and `ORDER` discounts must not accept a non-null lifetime quantity limit. CATEGORY caps need a separate multi-product quantity policy; ORDER discounts are money-based on post-LINE subtotal, so unit quantity is not a meaningful V1 cap dimension.
- The limit is cumulative for one `(discountId, userId)` across the lifetime of that Discount row. It is not per Order, per day, per cart, or an Inventory/SKU availability limit.
- PRC-03/PRC-05 single LINE winner and LINE-then-ORDER composition ([ADR 0015](../docs/adr/0015-line-then-order-discount-composition.md)) are unchanged. Usage is consumed only when a capped PRODUCT discount is the **applied** LINE winner. A CATEGORY winner on the same line does not consume PRODUCT-cap usage.
- A capped PRODUCT discount with `remainingEligibleQuantity = 0` is **not LINE-eligible** for winner selection (so it cannot block a CATEGORY winner). Partial entitlement (`remainingEligibleQuantity > 0` but less than requested quantity) keeps the PRODUCT discount eligible; the single winner still applies only to `discountedQuantity`.

### Terminology

| Term                        | Meaning                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `maxQuantityPerCustomer`    | Configured lifetime cap on a PRODUCT Discount (`null` = unlimited)                            |
| `consumedQuantity`          | Durable units already consumed for `(discountId, userId)`                                     |
| `remainingEligibleQuantity` | Derived: unlimited when cap is null; else `max(0, maxQuantityPerCustomer − consumedQuantity)` |
| `requestedQuantity`         | Normalized Order-line quantity                                                                |
| `discountedQuantity`        | Units that receive the LINE discount (`0 … requestedQuantity`)                                |
| `nonDiscountedQuantity`     | Derived: `requestedQuantity − discountedQuantity`                                             |
| Consumption / release       | Create-time consume; pre-`SHIPPED` cancel release — see Orders                                |

- Prefer naming: `DiscountCustomerUsage` / `DiscountUsageRecord` (implemented in DLU-02).

### Over-limit behavior (accepted: partial discount)

Exceeding remaining entitlement must **not** reject the purchase.

Compared options (DLU-01):

1. Reject line/Order — **rejected** for V1.
2. Discount only remaining eligible quantity; remainder at normal unit price — **accepted**.
3. Apply no discount to the whole line when entitlement is insufficient — **rejected** for V1 (strictly worse than partial).

For a capped PRODUCT LINE winner:

- `discountedQuantity = min(requestedQuantity, remainingEligibleQuantity)`.
- LINE discount base = `unitPrice × discountedQuantity` (PERCENT/FIXED PRC-03 math on that reduced base).
- `grossLineTotal = unitPrice × requestedQuantity`; `finalLineTotal = grossLineTotal − lineDiscountAmount`.
- ORDER discounts still apply to `Σ finalLineTotal` after LINE (ADR 0015).

Example: unit `100_000`, qty `5`, 20% off, `discountedQuantity = 3` → gross `500_000`, discount `60_000`, final `440_000`.

### Persistence, concurrency, and authority

- PostgreSQL is authoritative. Forbidden: Redis/cache/BullMQ/distributed-lock correctness; `SUM(OrderLine)` read-check-write without locked usage state.
- Preferred model: **`DiscountCustomerUsage` aggregate** `(discountId, userId, consumedQuantity)` **plus append-only `DiscountUsageRecord`** consume/release rows with uniqueness preventing double consume/release per Order.
- Lock aggregates `FOR UPDATE` in sorted `discountId` order inside the ORD-03 REPEATABLE READ transaction after idempotency and before Inventory locks ([orders.md](orders.md)).
- Pricing receives the trusted customer id from Orders; clients never supply Discount identity, consumed quantity, or discounted quantity.
- OrderLine snapshots must store explicit `discountedQuantity` (with existing money/applied-discount columns). Do not reconstruct partial eligibility later from mutable usage tables alone.

### Lifecycle hooks (Orders-owned orchestration)

- Consume atomically on successful Order create with pricing snapshot + Inventory reservation.
- Release on cancellation before `SHIPPED`, atomically with Inventory release.
- `SHIPPED` and later: consumed quantity stays consumed.
- Returns do **not** restore entitlement in V1 (ORD-07 must not infer restore from `RETURNED`/restock; [ADR 0024](../docs/adr/0024-order-returns-bulk-transitions-and-dispatch-board.md)).
- Same `discountId` keeps the same lifetime usage across deactivate/reactivate. Lowering the configured cap below already-consumed quantity yields zero remaining eligibility without rewriting history.

Implementation: schema, Admin DTO fields (`maxQuantityPerCustomer`), PRC-05 partial pricing, ORD-03 CONSUME, and pre-ship RELEASE are delivered in DLU-02. Customer Order-create HTTP is ORD-03A.

## Permissions

- **Price changes:** Admin Product PATCH (`CATALOG_MANAGE`) remains supported for catalog workflows. PRC-04 adds `PATCH admin/pricing/products/:productId/price` under `DISCOUNT_MANAGE` with the same `PricingService` semantics (atomic history append, no-op when unchanged, server-side actor).
- **Price history read:** `GET admin/pricing/products/:productId/price-history` requires `DISCOUNT_READ`. Append-only — no update/delete HTTP.
- **Discount admin:** list/read routes require `DISCOUNT_READ`; create/update/activate/deactivate require `DISCOUNT_MANAGE`. Customer (`USER`) principals receive `403`.

## Admin HTTP surface (PRC-04)

| Method  | Path                                              | Permission        | Notes                                                                             |
| ------- | ------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------- |
| `GET`   | `admin/pricing/products/:productId/price-history` | `DISCOUNT_READ`   | Paginated; newest first (`createdAt desc`, `id desc` tie-break)                   |
| `PATCH` | `admin/pricing/products/:productId/price`         | `DISCOUNT_MANAGE` | Body: `{ price }` integer Toman; actor from Admin session                         |
| `GET`   | `admin/discounts`                                 | `DISCOUNT_READ`   | Pagination, `search` (name), filters `isActive`/`type`/`target`, sort allowlist   |
| `POST`  | `admin/discounts`                                 | `DISCOUNT_MANAGE` | Create with strict DTO validation; optional PRODUCT-only `maxQuantityPerCustomer` |
| `PATCH` | `admin/discounts/:id`                             | `DISCOUNT_MANAGE` | Update allowlist; no `isActive`; may set/clear `maxQuantityPerCustomer`           |
| `POST`  | `admin/discounts/:id/activate`                    | `DISCOUNT_MANAGE` | Sets `isActive = true`                                                            |
| `POST`  | `admin/discounts/:id/deactivate`                  | `DISCOUNT_MANAGE` | Sets `isActive = false`                                                           |

Promo-banner persistence/API is **not** implemented in PRC-04 — no evidenced legacy requirements in-repo (see roadmap unresolved decisions).
