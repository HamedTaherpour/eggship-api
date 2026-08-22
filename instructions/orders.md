# Orders

EggShip V1 has **no online payment gateway**. Warehouse/operations ships goods; payment and settlement occur outside the application. Do not introduce Payment, gateway, card, checkout-payment, or transaction-id models without an approved phase. No payment-dependent state or transition exists in V1 ([ADR 0014](../docs/adr/0014-order-state-machine-and-transition-authorization.md)).

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

Future order creation receives conceptually `productId` + `quantity`. The backend reads current catalog/pricing state via PRC-05 `OrderPricingService`, computes snapshots, and persists them in ORD-03. **Clients must never submit authoritative `unitPrice`, `lineTotal`, discount ids, or order totals.**

- Currency: **integer Toman** ([ADR 0010](../docs/adr/0010-integer-toman-money.md)).
- `OrderLine.unitPrice`: PostgreSQL `INTEGER` (int4), same bounds as `Product.price`.
- `OrderLine.lineTotal`, `Order.subtotal`, `Order.total`: PostgreSQL `BIGINT` / Prisma `BigInt` because `unitPrice × quantity` and multi-line sums can exceed int4 ([ADR 0013](../docs/adr/0013-order-historical-snapshots.md)).
- `lineTotal` is **persisted** (not derived at read time) for audit integrity.
- Use `src/modules/orders/domain/order-money.ts` for safe bigint multiplication/summing; never use floating point.
- **Discount composition** for create-time money is owned by Pricing PRC-05 ([ADR 0015](../docs/adr/0015-line-then-order-discount-composition.md), [pricing.md](pricing.md)): LINE then ORDER on the discounted subtotal. ORD-03 must persist the PRC-05 snapshot without re-reading mutable Product/Discount state.

### PRC-05 → ORD-03 snapshot contract

PRC-05 returns a persistence-neutral snapshot. ORD-01 columns today store gross `lineTotal = unitPrice × quantity` only. ORD-03 owns the minimal migration to persist discounted amounts and applied-discount evidence. Until that migration lands, do not write discounted `finalLineTotal` into `OrderLine.lineTotal`.

Required snapshot facts ORD-03 must be able to consume:

| Area  | Fields                                                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line  | `productId`, `productName`, `categoryId`, `unitPrice`, `quantity`, `grossLineTotal`, `lineDiscountAmount`, `finalLineTotal`, `appliedLineDiscount` |
| Order | `grossSubtotal`, `lineDiscountTotal`, `subtotalAfterLineDiscounts`, `orderDiscountAmount`, `total`, `appliedOrderDiscount`, `evaluatedAt`          |

**Transaction isolation:** when ORD-03 calls `priceOrderLines({ tx })` inside the create transaction, that transaction **must** use PostgreSQL **REPEATABLE READ** (or equivalent) so Product and Discount reads share one snapshot. Alternatively, price via standalone `runSnapshotRead` and persist the frozen snapshot in the write transaction without re-reading mutable catalog/discount state.

JSON: totals within `Number.MAX_SAFE_INTEGER` may serialize as numbers; larger exact values serialize as decimal strings — never floats.

## Customer ownership

Every customer order belongs to exactly one `User` via `userId` (`ON DELETE RESTRICT`). `userId` is immutable after creation.

Customer reads should prefer **`findOwnedById(orderId, userId)`** rather than fetch-then-compare. Admin order access is permission-based (ORD-06), not owner-scoped — do not mix semantics in one ambiguous repository method.

### Customer BOLA

- Customer paths derive `userId` from the authenticated principal via `requireCustomerOwnerId`.
- Another user's order or a missing order → **`ORDER_NOT_FOUND` (404)** with the same response shape. Never confirm cross-user existence with 403.
- Wrong subject type (e.g. Admin on a customer route) → **`AUTH_FORBIDDEN` (403)** per [authorization.md](authorization.md).
- Customer cancel must not expose Inventory internals; map Inventory failures to **`ORDER_INVALID_TRANSITION`**.

## Status vocabulary and transition graph

Persistence enum (ORD-01). V1 transition rules are locked in [ADR 0014](../docs/adr/0014-order-state-machine-and-transition-authorization.md).

**Canonical graph** — no other transitions are legal:

```text
PENDING_REVIEW → CONFIRMED
PENDING_REVIEW → CANCELLED
CONFIRMED      → SHIPPED
CONFIRMED      → CANCELLED
SHIPPED        → DELIVERED
```

`DELIVERED → RETURNED` is reserved for **ORD-07** only. ORD-02 does not implement it.

**Terminal states:** `CANCELLED`, `RETURNED`. `DELIVERED` is not strictly terminal (ORD-07 may transition to `RETURNED`).

Do not encode the state machine in CHECK constraints.

## Transition commands

Transitions are **explicit application commands** — not a generic status PATCH and not a public `transition(orderId, toStatus)` API:

| Command                        | From → to                                     | Inventory         |
| ------------------------------ | --------------------------------------------- | ----------------- |
| `confirmOrder`                 | `PENDING_REVIEW` → `CONFIRMED`                | none              |
| `cancelPendingOrderByCustomer` | `PENDING_REVIEW` → `CANCELLED` (owner-scoped) | `releaseForOrder` |
| `cancelOrderByAdmin`           | `PENDING_REVIEW` or `CONFIRMED` → `CANCELLED` | `releaseForOrder` |
| `shipOrder`                    | `CONFIRMED` → `SHIPPED`                       | `shipForOrder`    |
| `deliverOrder`                 | `SHIPPED` → `DELIVERED`                       | none              |

HTTP, `AccessTokenGuard`, `PermissionGuard`, and BOLA mapping belong to ORD-05/ORD-06. Commands accept a trusted `USER`/`ADMIN` actor (UUID id). Customer cancel uses `actor.id` as `userId` and cannot cancel `CONFIRMED`. Confirm/ship/deliver/admin-cancel require an `ADMIN` actor at the command boundary; they do not check `ORDER_TRANSITION` themselves.

Canonical legal pairs live in `src/modules/orders/domain/order-transitions.ts`. `DELIVERED → RETURNED` is absent from that table.

### Repository primitives

Winner election is a conditional `UPDATE ... WHERE status = expectedFrom RETURNING`. There is no `updateStatus` / generic patch. Closed primitives:

- `transitionPendingToConfirmed`
- `transitionPendingToCancelled`
- `transitionPendingToCancelledForOwner` (`userId` in `WHERE`)
- `transitionConfirmedToCancelled`
- `transitionConfirmedToShipped`
- `transitionShippedToDelivered`

Zero rows: re-read committed state (`findById` or `findOwnedById` for customer cancel). Same target status → idempotent success (no Inventory call, timestamps/reason/`deliveryAt` unchanged). Missing → `ORDER_NOT_FOUND`. Any other status → `ORDER_INVALID_TRANSITION`.

Admin cancel selects **one** from-state primitive from the current status. A lost `PENDING_REVIEW` update is classified; it must **not** then attempt `CONFIRMED → CANCELLED` in the same command (that would chase a concurrent confirm).

## Authorization: ownership vs Admin RBAC

| Actor                         | Rule                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer (`USER`)             | Cancel **own** `PENDING_REVIEW` orders only — **ownership-based**, not RBAC. Cannot cancel `CONFIRMED` or later. No cancellation after `SHIPPED`. |
| Admin with `ORDER_TRANSITION` | Confirm, cancel (`PENDING_REVIEW` or `CONFIRMED`), ship, deliver per the graph. `ORDER_OPS` and `SUPER_ADMIN` hold this permission.               |
| `WAREHOUSE`                   | `ORDER_READ` only — read-only for Orders in V1.                                                                                                   |

Customer self-service remains subject to Auth account-disable policy. A User disabled **after** order creation does **not** auto-cancel open orders; admin may continue fulfillment.

## Cancellation reason

- **Admin** cancellation requires a trimmed reason, **1–500 characters**. Missing/empty/overlong → `ORDER_CANCELLATION_REASON_REQUIRED`.
- **Customer** pending cancellation does **not** require a reason; persist `cancelReason` as **null**.
- No cancellation-reason enum in V1.

## Lifecycle timestamps

Set on **first** occurrence only; **never clear**; idempotent replay must **not** rewrite them:

| Field         | Set when           |
| ------------- | ------------------ |
| `confirmedAt` | first confirmation |
| `shippedAt`   | first shipment     |
| `deliveredAt` | first delivery     |
| `cancelledAt` | first cancellation |

## `deliveryAt`

- Optional scheduled/expected delivery timestamp on `Order`.
- Not required at confirmation, before ship, or before deliver.
- Distinct from actual `deliveredAt`.
- No separate edit flow in V1.
- If provided on first confirm: valid `Date` or ISO-8601 instant; no "must be in the future" rule. Invalid → `ORDER_INVALID_INPUT`. Replay must not overwrite an existing value.

## Conditional transition concurrency

Use **conditional status UPDATE**, not application read-check-write. Exactly one competing valid transition wins:

```sql
UPDATE "Order"
SET status = ...
WHERE id = ...
  AND status = expectedFrom
RETURNING ...;
```

Zero rows updated → treat as invalid transition unless idempotent replay applies (see below).

## Idempotent replay

Same command when already in the target state → **idempotent success**:

- confirm when already `CONFIRMED`
- ship when already `SHIPPED`
- cancel when already `CANCELLED`
- deliver when already `DELIVERED`

On replay: do not rewrite lifecycle timestamps; do not repeat Inventory side effects.

Same command after a **different** winning transition → `ORDER_INVALID_TRANSITION`.

## Orders → Inventory orchestration

Orders orchestrate stock through **Inventory application contracts** only (`reserveForOrder`, `releaseForOrder`, `shipForOrder`) — Orders must not mutate Inventory tables directly.

| Transition / phase        | Inventory side effect       |
| ------------------------- | --------------------------- |
| Create → `PENDING_REVIEW` | `reserveForOrder` (ORD-03)  |
| Confirm → `CONFIRMED`     | none                        |
| Cancel before ship        | `releaseForOrder`           |
| Ship → `SHIPPED`          | `shipForOrder`              |
| Deliver → `DELIVERED`     | none                        |
| Return restock            | ORD-07 inspection flow only |

Inventory quantity semantics follow [ADR 0012](../docs/adr/0012-inventory-quantity-ledger-concurrency.md) / [inventory.md](inventory.md).

### Canonical cross-domain lock order

All Orders+Inventory flows that mutate both domains run in **one PostgreSQL transaction**. Lock order:

```text
PostgreSQL transaction
  → conditional Order row UPDATE / Order row lock
  → Inventory orderId advisory lock
  → Inventory rows FOR UPDATE sorted by productId
  → Reservation rows in the same order
  → quantity mutation + ledger
  → commit
```

Every Orders+Inventory flow must use this order.

Admin Inventory errors during ship/cancel may surface as Inventory errors after rollback. Customer cancel maps `INVENTORY_RESERVATION_NOT_FOUND` and `INVENTORY_RESERVATION_CONFLICT` to `ORDER_INVALID_TRANSITION` with the customer-cancel message. Other Inventory `ApplicationError`s on that path are treated as internal failures (not remapped to `ORDER_INVALID_TRANSITION` and not returned as Inventory codes or details). Unexpected persistence failures are not remapped.

## Inactive source entities

- Inactive **Product** does not block fulfillment of an already-created/reserved order.
- **Region** rename/deactivation does not change historical snapshot columns or block fulfillment.
- User disable after order creation does not auto-cancel; see authorization table above.

## `RETURNED` (deferred)

Coarse order-level outcome meaning a return process has completed. **ORD-07** owns return request/receipt/inspection/restock semantics. `RETURNED` never implies automatic inventory restock. ORD-02 does not implement `DELIVERED → RETURNED`.

## Order error codes

Keep a small stable set:

- `ORDER_NOT_FOUND`
- `ORDER_INVALID_TRANSITION`
- `ORDER_CANCELLATION_REASON_REQUIRED`
- `ORDER_INVALID_INPUT`

Do not add per-command status-error explosion.

## Mutable vs immutable Order fields

**Immutable after creation:** `id`, `userId`, customer/region/line snapshots, order-time money, `idempotencyKey` (when set), `createdAt`.

**Mutable through explicit domain transitions (ORD-02+):** `status`, lifecycle timestamps (`confirmedAt`, `shippedAt`, `deliveredAt`, `deliveryAt`), cancellation metadata (`cancelledAt`, `cancelReason`).

Return inspection workflow persistence belongs to ORD-07 — do not model full return semantics on `Order` in ORD-01/ORD-02.

## Inventory boundary

- `InventoryReservation.orderId` remains an **opaque UUID** with **no FK** to `Order`.
- V1 collapses duplicate `productId` lines before persistence: `UNIQUE(orderId, productId)` aligns with Inventory reservation identity.

## Idempotency foundation

`Order.idempotencyKey` (optional UUID) with `UNIQUE(userId, idempotencyKey)` prepares ORD-03 HTTP `Idempotency-Key` → one logical order. The key is immutable retry identity only — not the Inventory reservation idempotency surface (that uses `Order.id`).

## Deferred snapshot extensions (MIG-01 / profile tasks)

No in-repo legacy Order contract exists yet (`MIG-01` PLANNED). The following remain explicitly deferred rather than invented:

- Shipping/delivery **address** snapshot columns (User profile address fields do not exist — AUTH-07 is phone-only).
- Store name, manager name, coordinates, and profile `regionId` FK.
- Human-readable order numbers/codes.
- Order notes, invoice metadata.
- Discount **persistence columns** on Order/OrderLine (calculation + snapshot contract delivered in PRC-05; ORD-03 owns the minimal migration to store them).
- Payment/settlement recording.

When profile/address support lands, Orders must snapshot address at creation — **never reference a mutable User address directly** for historical display.

## Module layout

`src/modules/orders/` — domain types, money helpers, `OrderTransitionService` (`confirmOrder`, `cancelPendingOrderByCustomer`, `cancelOrderByAdmin`, `shipOrder`, `deliverOrder`), `OrderRepository` (`createWithLines`, `findById`, `findOwnedById`, closed conditional status updates). HTTP in ORD-04–ORD-06. Orders imports Inventory application contracts; Inventory must not import Orders.

## Related ADRs

- [0010 — Integer Toman money](../docs/adr/0010-integer-toman-money.md)
- [0012 — Inventory quantity / ledger / concurrency](../docs/adr/0012-inventory-quantity-ledger-concurrency.md)
- [0013 — Order historical snapshots](../docs/adr/0013-order-historical-snapshots.md)
- [0014 — Order state machine and transition authorization](../docs/adr/0014-order-state-machine-and-transition-authorization.md)
- [0015 — V1 LINE then ORDER discount composition](../docs/adr/0015-line-then-order-discount-composition.md)
