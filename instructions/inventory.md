# Inventory

Durable Inventory quantity, ledger, concurrency, and cross-module rules for EggShip. Field-level HTTP contracts belong in OpenAPI; persistence details belong to INV-01B+. Architecture decisions live in [ADR 0012](../docs/adr/0012-inventory-quantity-ledger-concurrency.md).

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

## Returns

A return/request alone does **not** increase stock.

Warehouse/operations inspects returned goods and decides sellable versus unsellable quantities. Inventory only restocks the approved sellable quantity (`onHand += sellableQty`). Unsellable returned units do not generate a further stock decrease: they already left `onHand` at `SHIPPED` and were never re-entered.

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

## Authorization

Admin inventory reads/adjustments use `INVENTORY_READ` / `INVENTORY_ADJUST` ([authorization.md](authorization.md)). Order-driven reserve/release/ship authorize at the Orders HTTP boundary; Inventory still owns the quantity mutation contract.

## Unresolved (do not invent)

- Whether a future `PACKED` / `PICKED` state moves the physical `onHand` decrement earlier than `SHIPPED`
- Partial fulfillment or split shipment after V1
- Detailed return-inspection HTTP/domain design (ORD-07)
- Public exposure of exact `available`
- Preferred-customer allocation / fairness under contention
