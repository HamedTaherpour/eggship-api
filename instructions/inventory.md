# Inventory

Durable Inventory quantity, ledger, concurrency, and cross-module rules for EggShip. Field-level HTTP contracts belong in OpenAPI; persistence rules for INV-01B live below. Architecture decisions live in [ADR 0012](../docs/adr/0012-inventory-quantity-ledger-concurrency.md).

Inventory quantities are **not** Product fields ([catalog.md](catalog.md)). PostgreSQL is authoritative ([database.md](database.md), [ADR 0002](../docs/adr/0002-postgresql-prisma.md)).

## Quantities

| Term        | Meaning                                                                               |
| ----------- | ------------------------------------------------------------------------------------- |
| `onHand`    | Sellable physical units currently in the warehouse.                                   |
| `reserved`  | Sellable physical units promised to open, unshipped orders. Still physically present. |
| `available` | Units that may still be promised to a new order.                                      |

**`available = onHand - reserved`**. Derive it in application/API mapping. Never persist `available`.

## Invariants

- `onHand >= 0`
- `reserved >= 0`
- `reserved <= onHand`
- Negative stock is never allowed.
- Prefer database CHECK constraints plus atomic conditional updates; do not rely on application checks alone.

## Lifecycle (V1)

Order states are not Inventory states. Inventory reacts only through Inventory-owned commands:

| Order event                                                  | Inventory effect                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| Create / enter `PENDING_REVIEW`                              | `RESERVE`: `reserved += qty`                                          |
| `CONFIRMED`                                                  | No quantity mutation                                                  |
| `SHIPPED`                                                    | `SHIP`: `onHand -= shippedQty`, `reserved -= shippedQty`              |
| Cancel/reject before `SHIPPED` (including after `CONFIRMED`) | `RELEASE`: `reserved -= qty`; `onHand` unchanged                      |
| `DELIVERED`                                                  | No quantity mutation                                                  |
| Post-delivery return                                         | Only explicit `returnToStock(sellableQty)` after warehouse inspection |

There is **no automatic reservation TTL** in V1. A reservation remains until an explicit operational transition releases or ships it.

**Partial fulfillment is not supported in V1.** Multi-item reservation and order acceptance are all-or-nothing.

## Adjustments

Never blind-set current balances (for example `SET onHand = 94`).

Physical corrections use a signed adjustment delta, required reason, and ledger evidence:

```text
system onHand = 100
physical count = 94
→ ADJUST -6
```

An adjustment that would violate `onHand >= reserved` or non-negativity must fail safely.

## Ledger

`InventoryLedger` is append-only **business stock movement** history. It is not the live availability store and is not the Admin AuditLog ([observability.md](observability.md); AUD-01).

Approved V1 event types:

- `RECEIVE`
- `ADJUST`
- `RESERVE`
- `RELEASE`
- `SHIP`
- `RETURN_TO_STOCK`
- `WRITE_OFF` — sellable warehouse stock that itself becomes unsellable

Corrections are **additional** ledger entries. Do not update or delete prior ledger rows.

## Returns (ORD-07)

Canonical contract: [ADR 0024](../docs/adr/0024-order-returns-bulk-transitions-and-dispatch-board.md).

A return/request alone does **not** increase stock.

Warehouse/operations inspects returned goods after delivery. V1 records partial line-level returns in a dedicated Orders-owned return aggregate (`OrderReturn` + `OrderReturnLine` conceptually). Each return line carries:

- **`sellableQuantity`** — restocked through `returnToStock` (`onHand += qty`, `RETURN_TO_STOCK` ledger)
- **`damagedQuantity`** — recorded for inspection history only; does **not** change `onHand` or `reserved` (units already left at `SHIPPED`)

Rules:

- An Order may have **multiple return events**; cumulative returned quantity per OrderLine must not exceed shipped/eligible quantity.
- **`reserved` is unchanged** by post-shipment returns.
- Return recording is Orders-orchestrated; Inventory exposes `returnToStock` only — Orders must not mutate Inventory tables directly.
- Multi-SKU return restock uses deterministic **`productId` ascending** lock order inside one PostgreSQL transaction with the return aggregate write.
- Return creation is idempotent (same key + payload → replay; conflicting payload → conflict) and concurrency-safe against over-return and double-restock.

Unsellable returned units do not generate a further stock decrease: they already left `onHand` at `SHIPPED` and were never re-entered.

## Representation

V1 uses:

- aggregate current balances (`Inventory`)
- per-order reservation rows (`InventoryReservation`)
- append-only ledger (`InventoryLedger`)

## Concurrency

- Application read-check-write is **forbidden**.
- Reserve, release, ship, receive, and adjust must use **atomic conditional PostgreSQL updates** (and deterministic row locking for multi-SKU work).
- Multi-item operations lock/update Inventory rows in deterministic `productId` ascending order inside **one** PostgreSQL transaction.

## Cross-module boundary

Orders orchestrates through Inventory **application contracts**. Orders must not mutate Inventory tables or repositories directly. Inventory owns its invariants.

When order creation and reservation integrate, they share one PostgreSQL transaction via an opaque transaction context — modular monolith composition, not distributed transactions ([architecture.md](architecture.md), [ADR 0001](../docs/adr/0001-modular-monolith.md)).

## Redis

Redis is **not** authoritative for Inventory balances, reservations, or stock locks ([redis.md](redis.md), [ADR 0003](../docs/adr/0003-redis-bullmq.md)). Do not add inventory caches or Redis locks for correctness.

## Persistence (INV-01B)

- One `Inventory` row per Product. `productId` is the primary key. `available` is derived in mapping and is never a column.
- Database CHECKs enforce `onHand >= 0`, `reserved >= 0`, and `reserved <= onHand`. Reservation `quantity > 0`. Ledger after-balances obey the same non-negative/`reserved <= onHand` rules. Quantities are PostgreSQL `integer` whole units (int4); overflow is rejected.
- `ensureForProduct` uses `INSERT ... ON CONFLICT ("productId") DO NOTHING` (then select). Product create and `ensureForProduct` share one PostgreSQL transaction via the opaque `TransactionContext` / `TransactionRunner` (Prisma stays in infrastructure). Migration backfill inserts `onHand=0, reserved=0` for existing Products.
- Conditional stock updates live in Inventory infrastructure as tagged `Prisma.sql`. Success is exactly one returning row. Zero rows are classified as missing inventory versus insufficient/invalid without exposing SQL. Multi-SKU locks are sequential `SELECT ... WHERE "productId" = $id FOR UPDATE` in sorted id order so PostgreSQL cannot lock in heap-scan order.
- Repeat RESERVE uses `INSERT ... ON CONFLICT ("orderId", "productId") DO NOTHING` so a joined Orders transaction is not aborted by `23505`. The conflict path `SELECT ... FOR UPDATE`s the existing reservation so a retry cannot return a stale `ACTIVE` after a concurrent RELEASE/SHIP. Matching ACTIVE rows are idempotent; mismatched quantity/status conflict.
- Reserve/release/ship lock the Inventory row (`FOR UPDATE`) before writing `InventoryReservation`. That matches `lockBalances` / `lockAndInspectAvailability` (inventory first, then reservation) and avoids deadlocks with multi-SKU composition. Callers that mutate several SKUs must still lock all Inventory rows in sorted `productId` order before any reservation write.
- Order-level `reserveForOrder` / `releaseForOrder` take a transaction-scoped PostgreSQL advisory lock on `orderId` **before** Inventory row locks. That serializes same-order retries (including disjoint SKU sets) so a crash/retry cannot persist a partial reservation set. This is not a Redis or distributed lock. A true PostgreSQL deadlock (`40P01`) is not retried automatically; deterministic lock order should prevent it on the multi-SKU path, and a residual deadlock remains an unexpected operational failure.
- `InventoryReservation.orderId` is an opaque UUID with **no** FK to Orders. `UNIQUE(orderId, productId)` is the V1 reservation identity and the lookup prefix for `findByOrderId`; do not add a duplicate `orderId` index. Status moves with `UPDATE ... WHERE status = 'ACTIVE'`. Repeat RELEASE of an already-`RELEASED` order is idempotent; any `SHIPPED` row, mixed statuses, or partial existing rows conflict. Cross-status reserve retries conflict and do not recreate `ACTIVE`.
- `InventoryLedger` is append-only. Repositories expose append/query only. `reason` is required at the application layer for `ADJUST` and `WRITE_OFF` (not a per-type database CHECK). Actor CHECK: `SYSTEM` has null `actorId`; `USER`/`ADMIN` require `actorId`. No FK from `actorId` to User/Admin.
- Ledger uniqueness is a **partial** unique index on `(type, referenceType, referenceId, productId)` for `RESERVE`/`RELEASE`/`SHIP` with `referenceType = ORDER` and non-null `referenceId`. Manual `RECEIVE`/`ADJUST` events are not covered so operators may reuse a reference. A universal unique on those four columns would false-conflict legitimate adjustments.
- Multi-SKU work deduplicates and sorts ids in application code, then locks each Inventory row with `SELECT ... WHERE "productId" = $id FOR UPDATE` in that order (not a client-controlled `ORDER BY`). Inspections report all shortages and write nothing.
- Admin warehouse commands (INV-02): `POST /api/v1/admin/inventory/:productId/receive` and `POST /api/v1/admin/inventory/:productId/adjust` (delta + required reason) gated by `INVENTORY_ADJUST`; `GET /api/v1/admin/inventory/:productId` gated by `INVENTORY_READ`. Mutations require a UUID `Idempotency-Key` header; identical key + payload replays the committed result, conflicting payload returns `IDEMPOTENCY_CONFLICT`. Idempotency claims persist in `InventoryCommandIdempotency` inside the same PostgreSQL transaction as balance mutation and ledger append. Inactive products remain inventory-correctable; catalog visibility stays separate. `WRITE_OFF` HTTP remains later work.
- Order reservation contracts (INV-03) are **internal application methods**, not HTTP. There is no `POST /inventory/reserve`, `/release`, or Orders route in this task. `reserveForOrder({ orderId, lines, actor }, tx?)` and `releaseForOrder({ orderId, actor }, tx?)` accept a validated domain actor (future Orders supplies it) and may join a caller-supplied opaque `TransactionContext`. Duplicate input `productId`s are collapsed before locking; collapsed quantity must fit int4. Multi-SKU reserve is all-or-nothing: lock every Inventory row in sorted `productId` order, collect every shortage, and write nothing if any line is missing or short. Missing Inventory is `INVENTORY_NOT_FOUND` (do not create a row). Shortage details expose `{ productId, requested }` only — not exact `available`. `orderId` is the reservation idempotency identity: the same normalized lines replay without a second aggregate/ledger write; a different product set or quantity is `INVENTORY_RESERVATION_CONFLICT`. Do not heal partial existing rows. Release moves every `ACTIVE` line to `RELEASED` (`reserved -= qty`, `onHand` unchanged) in one transaction; all-`RELEASED` replays; any `SHIPPED` or mixed status conflicts. Inventory does not query `Product.isActive`. Known persistence failures map to existing Inventory errors; unexpected driver failures stay operational. Ledger `referenceType = ORDER` and `referenceId = orderId`. `correlationId` is stored only when it is already a UUID (HTTP `req_…` ids are omitted; `orderId` is not substituted). Per-SKU `releaseReservation` / `shipReservation` remain INV-01B primitives for internal use; Orders must not complete a subset of a multi-SKU order through them (that mixed status then fail-closes at `releaseForOrder` / `shipForOrder`). `lockAndInspectAvailability` is warehouse-internal and is not an HTTP mapping. Future Orders must not take Inventory `FOR UPDATE` before calling `reserveForOrder` in the same transaction (that inverts advisory vs Inventory lock order).
- Order ship contract (INV-04) is **internal application only** — no HTTP. `shipForOrder({ orderId, actor }, tx?)` ships the entire logical reservation set for one order when every row is `ACTIVE`: `onHand -= qty`, `reserved -= qty`, reservation `ACTIVE → SHIPPED`, and one `SHIP` ledger row per product in the same PostgreSQL transaction. Physical stock leaves the warehouse at ship time (Order `SHIPPED`). No partial fulfillment in V1: do not accept a subset of lines; mixed `ACTIVE`/`SHIPPED`/`RELEASED` fail-closes with `INVENTORY_RESERVATION_CONFLICT` (display: ship-incompatible reservation state). All-`SHIPPED` replays idempotently without a second aggregate or ledger write. No reservation rows → `INVENTORY_RESERVATION_NOT_FOUND`. Same-order ship vs release serializes on the order-scoped advisory lock; the winner commits fully and the loser conflicts — never mixed terminal states or double decrement. Lock order: advisory lock on `orderId`, Inventory rows in sorted `productId` order, reservation rows in the same order, then mutations/ledger. Shipping already-reserved goods does not change `available` (`(H-Q)-(R-Q)=H-R`). Joinable opaque `TransactionContext` for future Order status + Inventory ship in one transaction. Per-SKU `shipReservation` stays infrastructure-only; Orders calls `shipForOrder` only.
- Inventory reconciliation (INV-05) is **read-only diagnostics** — `InventoryReconciliationService.reconcileProduct(productId)` compares three representations without mutating any row: aggregate current balances (`Inventory.onHand` / `Inventory.reserved`), per-order reservation rows (`InventoryReservation`, ACTIVE sum vs aggregate `reserved`), and append-only ledger history (`InventoryLedger` delta reconstruction, after-balance chain, tail vs current, and ORDER lifecycle RESERVE/RELEASE/SHIP vs reservation status). Baseline is Product backfill/create at 0/0 plus append-only ledger; reconciliation never rewrites history or auto-repairs mismatches. Operator correction remains an explicit privileged command (for example `ADJUST`) that appends new ledger evidence — not ledger edits/deletes. Reads use one PostgreSQL transaction at **REPEATABLE READ** (`TransactionRunner.runSnapshotRead`) so Inventory, reservations, and ledger share one coherent snapshot without long `FOR UPDATE` locks over history. Inconsistency is a successful diagnostic result with stable issue codes; missing inventory is `INVENTORY_NOT_FOUND`. Reconciliation is not `InventoryLedger` business movement and is not Admin `AuditLog`. Observability: `inventory.reconciliation.completed` and `inventory.reconciliation.inconsistent` (productId, issueCount, durationMs — no full ledger dump).
- Admin inventory read/diagnostic APIs (INV-06): `GET /api/v1/admin/inventory` (paginated list joined with Product name/`isActive`; search on Product name only; sort allowlist; does **not** run reconciliation per row), existing `GET /api/v1/admin/inventory/:productId` balance, `GET .../ledger` (paginated append-only history, newest first), `GET .../reservations` (paginated reservation facts — `orderId`, quantity, status only; no Order customer PII), and `GET .../reconciliation` (maps `reconcileProduct`; HTTP 200 even when `INCONSISTENT`; `Cache-Control: no-store` on diagnostics). All gated by `INVENTORY_READ`. Mutations remain INV-02 (`INVENTORY_ADJUST` only). Inactive Product stock stays visible to Admin. Missing Inventory on diagnostic routes returns `INVENTORY_NOT_FOUND` — reads never call `ensureForProduct` or repair. No ledger edit/delete, no absolute stock setters, no reconciliation repair HTTP, no Redis cache.

## Authorization

Admin inventory reads/adjustments use `INVENTORY_READ` / `INVENTORY_ADJUST` ([authorization.md](authorization.md)). Order-driven reserve/release/ship authorize at the Orders HTTP boundary; Inventory still owns the quantity mutation contract.

## Unresolved (do not invent)

- Whether a future `PACKED` / `PICKED` state moves the physical `onHand` decrement earlier than `SHIPPED`
- Partial fulfillment or split shipment after V1
- Detailed return-inspection HTTP/domain design — canonical semantics in [ADR 0024](../docs/adr/0024-order-returns-bulk-transitions-and-dispatch-board.md); ORD-07 implements
- Public exposure of exact `available`
- Preferred-customer allocation / fairness under contention
