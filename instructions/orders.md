# Orders

EggShip V1 has **no online payment gateway**. Warehouse/operations ships goods; payment and settlement occur outside the application. Do not introduce Payment, gateway, card, checkout-payment, or transaction-id models without an approved phase.

## Historical snapshot principle

Orders are durable business records. **Historical display must not depend on mutable Product, User/profile, or Region state.**

At order creation the backend persists immutable snapshots:

| Field                            | Source at creation              | Mutable later? |
| -------------------------------- | ------------------------------- | -------------- |
| `OrderLine.productName`          | `Product.name`                  | No             |
| `OrderLine.unitPrice`            | `Product.price` (integer Toman) | No             |
| `OrderLine.lineTotal`            | server `unitPrice × quantity`   | No             |
| `Order.customerPhone`            | canonical `User.phone`          | No             |
| `Order.regionName`               | `Region.name`                   | No             |
| `Order.subtotal` / `Order.total` | server sum of line totals       | No             |

`OrderLine.productId` and `Order.regionId` retain traceability (`ON DELETE RESTRICT`). Deactivated Products/Regions must not alter historical snapshot columns.

Repositories must not expose generic updates for snapshot fields. ORD-02 owns explicit status/lifecycle mutations.

## Server-authoritative money

Future order creation receives conceptually `productId` + `quantity` (and approved pricing inputs). The backend reads current catalog/pricing state, computes snapshots, and persists them. **Clients must never submit authoritative `unitPrice`, `lineTotal`, or order totals.**

- Currency: **integer Toman** ([ADR 0010](../docs/adr/0010-integer-toman-money.md)).
- `OrderLine.unitPrice`: PostgreSQL `INTEGER` (int4), same bounds as `Product.price`.
- `OrderLine.lineTotal`, `Order.subtotal`, `Order.total`: PostgreSQL `BIGINT` / Prisma `BigInt` because `unitPrice × quantity` and multi-line sums can exceed int4 ([ADR 0013](../docs/adr/0013-order-historical-snapshots.md)).
- `lineTotal` is **persisted** (not derived at read time) for audit integrity and future discount allocation.
- Use `src/modules/orders/domain/order-money.ts` for safe bigint multiplication/summing; never use floating point.

JSON: totals within `Number.MAX_SAFE_INTEGER` may serialize as numbers; larger exact values serialize as decimal strings — never floats.

## Customer ownership

Every customer order belongs to exactly one `User` via `userId` (`ON DELETE RESTRICT`). `userId` is immutable after creation.

Customer reads should prefer **`findOwnedById(orderId, userId)`** rather than fetch-then-compare. Admin order access is permission-based (ORD-06), not owner-scoped — do not mix semantics in one ambiguous repository method.

## Status vocabulary

Persistence enum (ORD-01); transition rules and authorization belong to ORD-02:

`PENDING_REVIEW` → `CONFIRMED` → `SHIPPED` → `DELIVERED`  
Terminal: `CANCELLED`, `RETURNED`

Inventory quantity effects follow [ADR 0012](../docs/adr/0012-inventory-quantity-ledger-concurrency.md) / [inventory.md](inventory.md). Do not encode the state machine in CHECK constraints.

## Mutable vs immutable Order fields

**Immutable after creation:** `id`, `userId`, customer/region/line snapshots, order-time money, `idempotencyKey` (when set), `createdAt`.

**Mutable through explicit domain transitions (ORD-02+):** `status`, lifecycle timestamps (`confirmedAt`, `shippedAt`, `deliveredAt`, `deliveryAt`), cancellation metadata (`cancelledAt`, `cancelReason`).

Return inspection workflow persistence belongs to ORD-07 — do not model full return semantics on `Order` in ORD-01.

## Inventory boundary

- `InventoryReservation.orderId` remains an **opaque UUID** with **no FK** to `Order`.
- Orders orchestrate stock through **Inventory application contracts** (`reserveForOrder`, `releaseForOrder`, `shipForOrder`) in ORD-03 — Orders must not mutate Inventory tables directly.
- V1 collapses duplicate `productId` lines before persistence: `UNIQUE(orderId, productId)` aligns with Inventory reservation identity.

## Idempotency foundation

`Order.idempotencyKey` (optional UUID) with `UNIQUE(userId, idempotencyKey)` prepares ORD-03 HTTP `Idempotency-Key` → one logical order. The key is immutable retry identity only — not the Inventory reservation idempotency surface (that uses `Order.id`).

## Deferred snapshot extensions (MIG-01 / profile tasks)

No in-repo legacy Order contract exists yet (`MIG-01` PLANNED). The following remain explicitly deferred rather than invented:

- Shipping/delivery **address** snapshot columns (User profile address fields do not exist — AUTH-07 is phone-only).
- Store name, manager name, coordinates, and profile `regionId` FK.
- Human-readable order numbers/codes.
- Order notes, invoice metadata, discount snapshots (`PRC-*`).
- Payment/settlement recording.

When profile/address support lands, Orders must snapshot address at creation — **never reference a mutable User address directly** for historical display.

## Module layout

`src/modules/orders/` — domain types, money helpers, `OrderRepository` (`createWithLines`, `findById`, `findOwnedById`). No HTTP in ORD-01.

## Related ADRs

- [0010 — Integer Toman money](../docs/adr/0010-integer-toman-money.md)
- [0012 — Inventory quantity / ledger / concurrency](../docs/adr/0012-inventory-quantity-ledger-concurrency.md)
- [0013 — Order historical snapshots](../docs/adr/0013-order-historical-snapshots.md)
