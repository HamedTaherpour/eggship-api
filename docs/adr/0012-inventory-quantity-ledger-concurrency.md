# ADR 0012: Inventory quantity model, ledger, and PostgreSQL concurrency

## Status

Accepted

## Context

EggShip is a wholesale egg ordering system. Products exist independently of stock. Customers place orders that warehouse/operations reviews, prepares, and ships; payment settles outside EggShip. The API must prevent overselling under concurrent hot-SKU attempts, keep warehouse counts operable for a small team, and leave PostgreSQL authoritative for Inventory. Redis already exists for ephemeral work and must not become a stock source of truth.

INV-01A analyzed quantity semantics, order-lifecycle effects, multi-item transactions, idempotency, returns, ledger design, and Orders↔Inventory boundaries. Architecture-owner decisions for V1 are locked below. Schema and application implementation belong to INV-01B onward; this ADR does not invent Orders HTTP or Redis stock state.

## Decision

- **PostgreSQL** is the sole source of truth for inventory balances, reservations, and ledger history. Redis is not used for inventory correctness, reservation state, or distributed stock locks.
- Persist current balances as **`onHand`** (sellable physical units in the warehouse) and **`reserved`** (sellable units promised to open unshipped orders). **`available = onHand - reserved`** and is **derived, never persisted**.
- Enforce **`onHand >= 0`**, **`reserved >= 0`**, and **`reserved <= onHand`**. Negative stock is never allowed.
- Represent stock as **aggregate current balances** + **per-order reservation rows** + an **append-only InventoryLedger**.
- **Reserve at order creation** (`PENDING_REVIEW`): `reserved += qty`. **`CONFIRMED`** and **`DELIVERED`** change no inventory quantities.
- **Ship at `SHIPPED`**: `onHand -= shippedQty` and `reserved -= shippedQty`. Cancel/reject **before** `SHIPPED` (including after `CONFIRMED`) **releases** reservation (`reserved -= qty`; `onHand` unchanged). No automatic reservation TTL in V1.
- **Partial fulfillment is not supported in V1**; multi-item reservation is all-or-nothing in one PostgreSQL transaction with deterministic `productId` ordering.
- Primary concurrency: **atomic conditional PostgreSQL updates**; multi-SKU paths use deterministic row locking. Application read-check-write is forbidden.
- Ledger event types: `RECEIVE`, `ADJUST`, `RESERVE`, `RELEASE`, `SHIP`, `RETURN_TO_STOCK`, and `WRITE_OFF` (sellable warehouse stock that becomes unsellable). Corrections are new ledger rows, never edits/deletes of prior rows. Adjustments use signed deltas with reason — never blind `SET onHand`.
- Post-delivery returns do not restock automatically. Only warehouse-approved **sellable** inspected quantity may call `returnToStock` (`onHand += sellableQty`). Unsellable returned units do not decrease `onHand` again (they already left at `SHIPPED`).
- Orders orchestrate through **Inventory application contracts**. Orders must not mutate Inventory tables or repositories directly. Order creation and reservation share **one PostgreSQL transaction** when that integration lands (modular monolith; no distributed transactions).
- Same-order reserve/release serialize with a **transaction-scoped PostgreSQL advisory lock** on `orderId` before Inventory row locks. This prevents disjoint-SKU retries from persisting a partial reservation set. It is not a Redis or distributed lock. INV-03 implements `reserveForOrder` / `releaseForOrder` as internal application contracts only — no public reservation HTTP.

## Consequences

- Accepted pending orders reduce `available` immediately; abandoned or unreviewed pending orders hold stock until ops confirms, cancels, or otherwise acts.
- Hot-SKU writes serialize on the Inventory row; correct under horizontal API scaling without Redis locks.
- Return inspection is required before restock; return/request alone never increases sellable stock.
- Ledger and current-state reconciliation become possible without treating the ledger as the live availability query path.
- Implementation is more complex than a single `stock` field, but prevents overselling and preserves warehouse meaning of `onHand` versus customer promises in `reserved`.
- Future `PACKED`/`PICKED` states, partial/split shipment, public exact availability, and preferred-customer allocation remain explicitly undecided and must not be assumed from this ADR.
