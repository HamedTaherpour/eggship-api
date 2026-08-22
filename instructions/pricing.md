# Pricing

Durable boundaries for Product current price and immutable price history. Field-level contracts belong in OpenAPI and Prisma; this file records ownership and lifecycle rules that must not drift.

## Owned resources

| Resource        | Module                 | Public | Admin manage                                        |
| --------------- | ---------------------- | ------ | --------------------------------------------------- |
| `Product.price` | `src/modules/products` | read   | via existing Admin Product PATCH (`CATALOG_MANAGE`) |
| `PriceHistory`  | `src/modules/pricing`  | none   | internal only in PRC-01; read APIs are PRC-04       |

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
- Do not implement discounts, calculation engines, or public pricing APIs here (PRC-02–PRC-05).

## Orders boundary

- Orders snapshot title and unit price at creation (ORD-01). Changing current price or appending history must not mutate existing Order lines.

## Permissions

- Admin price changes use existing `CATALOG_MANAGE` on Product PATCH until PRC-04 introduces dedicated pricing admin APIs.
