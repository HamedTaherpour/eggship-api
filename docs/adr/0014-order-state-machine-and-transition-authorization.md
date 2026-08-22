# ADR 0014: Order state machine and transition authorization

## Status

Accepted

## Context

ORD-01 introduced Order persistence with a `OrderStatus` enum and immutable historical snapshots ([ADR 0013](0013-order-historical-snapshots.md)). Inventory quantity effects for order lifecycle are locked in [ADR 0012](0012-inventory-quantity-ledger-concurrency.md). Reservation, release, and ship application contracts exist (INV-03, INV-04).

Before ORD-02 implements transition runtime, the architecture owner must approve the V1 state machine, actor rules, concurrency strategy, Orders↔Inventory orchestration, and error model. EggShip V1 has no online payment gateway; warehouse/operations fulfills orders and payment settles outside the application.

Alternatives considered:

- Generic status PATCH (rejected: hides invalid transitions, complicates authorization and audit).
- Per-transition permissions such as `ORDER_CANCEL` / `ORDER_SHIP` / `ORDER_DELIVER` (deferred: coarse `ORDER_TRANSITION` is sufficient for V1 with three admin roles).
- Cancellation-reason enum (rejected for V1: free-text admin reason only).
- `DELIVERED` as strictly terminal (rejected: ORD-07 may transition to `RETURNED`).
- Automatic inventory restock on `RETURNED` (rejected: restock only through ORD-07 inspection flow per ADR 0012).

## Decision

### Canonical transition graph

Only these transitions are legal in V1:

```text
PENDING_REVIEW → CONFIRMED
PENDING_REVIEW → CANCELLED
CONFIRMED      → SHIPPED
CONFIRMED      → CANCELLED
SHIPPED        → DELIVERED
```

`DELIVERED → RETURNED` is reserved for ORD-07 only. ORD-02 does not implement it. No other transitions are legal.

### Terminal semantics

- `CANCELLED` and `RETURNED` are terminal.
- `DELIVERED` is not strictly terminal because ORD-07 may transition it to `RETURNED`.

### Actors and authorization

- **Customer (`USER`)**: may cancel **own** orders in `PENDING_REVIEW` only. Ownership is enforced server-side from the authenticated principal — not RBAC. May **not** cancel `CONFIRMED` or any post-confirmation state. No cancellation after `SHIPPED`.
- **Admin with `ORDER_TRANSITION`**: may cancel `PENDING_REVIEW` or `CONFIRMED`; may confirm, ship, and deliver per the graph. `ORDER_OPS` and `SUPER_ADMIN` hold this permission. `WAREHOUSE` has `ORDER_READ` only — read-only for Orders in V1.
- V1 keeps coarse **`ORDER_TRANSITION`**; do not introduce `ORDER_CANCEL`, `ORDER_SHIP`, or `ORDER_DELIVER` yet.

### Customer cancellation policy

- User-disabled **after** order creation does **not** auto-cancel open orders; admin may continue fulfillment.
- Customer self-service remains subject to Auth account-disable policy on authenticated routes.

### Admin cancellation and reason

- Admin cancellation requires a **trimmed reason**, 1–500 characters.
- Customer pending cancellation does **not** require a reason; persist `cancelReason` as null.
- No cancellation-reason enum in V1.

### `deliveryAt`

- Optional scheduled/expected delivery timestamp on `Order`.
- Not required at confirmation, before ship, or before deliver.
- Distinct from actual `deliveredAt` (set on first delivery).
- No separate edit flow in V1.

### Lifecycle timestamps

Set on **first** occurrence only; never cleared; idempotent replay must not rewrite them:

- `confirmedAt` — first confirmation
- `shippedAt` — first shipment
- `deliveredAt` — first delivery
- `cancelledAt` — first cancellation

### `RETURNED` (deferred implementation)

- Coarse order-level outcome meaning a return process has completed.
- ORD-07 owns return request/receipt/inspection/restock semantics.
- `RETURNED` never implies automatic inventory restock.

### Inactive source entities

- Inactive **Product** does not block fulfillment of an already-created/reserved order.
- **Region** rename/deactivation does not change historical snapshot columns or block fulfillment ([ADR 0013](0013-order-historical-snapshots.md)).

### Inventory side effects

Follow [ADR 0012](0012-inventory-quantity-ledger-concurrency.md); Orders orchestrate through Inventory application contracts only:

| Order phase / transition  | Inventory mutation                            |
| ------------------------- | --------------------------------------------- |
| Create → `PENDING_REVIEW` | `reserveForOrder` (ORD-03)                    |
| Confirm → `CONFIRMED`     | none                                          |
| Cancel before ship        | `releaseForOrder`                             |
| Ship → `SHIPPED`          | `shipForOrder`                                |
| Deliver → `DELIVERED`     | none                                          |
| Return restock            | ORD-07 inspection flow only (`returnToStock`) |

### Transaction ownership and cross-domain lock order

All Orders+Inventory flows that mutate both domains run in **one PostgreSQL transaction** owned by Orders orchestration. Canonical lock order:

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

### Transition concurrency

Use **conditional status UPDATE**, not application read-check-write. Exactly one competing valid transition wins:

```sql
UPDATE "Order"
SET status = ...
WHERE id = ...
  AND status = expectedFrom
RETURNING ...;
```

Zero rows updated → `ORDER_INVALID_TRANSITION` (or idempotent success when replaying the same target state).

### Replay / idempotency

Same command replay when already in the target state → **idempotent success**:

- confirm when already `CONFIRMED`
- ship when already `SHIPPED`
- cancel when already `CANCELLED`
- deliver when already `DELIVERED`

Rules:

- Do not rewrite original lifecycle timestamps.
- Do not repeat Inventory side effects.
- Same command after a **different** winning transition → `ORDER_INVALID_TRANSITION`.

### Customer BOLA

- Customer paths derive `userId` from the authenticated principal.
- Another user's order or a missing order → same **`ORDER_NOT_FOUND` (404)**.
- Never expose cross-user existence with 403.
- Wrong subject type → **`AUTH_FORBIDDEN` (403)**.
- Customer cancel must not expose Inventory internals; map to `ORDER_INVALID_TRANSITION`.

### Error model

Keep a small stable Order code set:

- `ORDER_NOT_FOUND`
- `ORDER_INVALID_TRANSITION`
- `ORDER_CANCELLATION_REASON_REQUIRED`
- `ORDER_INVALID_INPUT`

Do not add per-command status-error explosion. Admin Inventory reservation errors during ship/cancel may surface as Inventory errors after transaction rollback.

### Commands, not generic PATCH

Transitions are **explicit commands** (confirm, cancel, ship, deliver). No generic status PATCH.

### No payment state

V1 has no payment-dependent state or transition.

## Consequences

- ORD-02 implements domain transition services and repository conditional updates; ORD-05/ORD-06 expose HTTP.
- ORD-03 order creation integrates `reserveForOrder` in the same transaction without requiring full transition runtime beyond architecture approval.
- ORD-07 must revisit this ADR before implementing `DELIVERED → RETURNED`.
- Finer admin permissions remain a future policy change with evidence, not a V1 assumption.
- Durable implementation rules live in `instructions/orders.md`; authorization notes in `instructions/authorization.md`.

## Related ADRs

- [0012 — Inventory quantity, ledger, and concurrency](0012-inventory-quantity-ledger-concurrency.md) — quantity semantics and Inventory contracts (not duplicated here).
- [0013 — Order historical snapshots](0013-order-historical-snapshots.md) — immutable snapshot columns (not duplicated here).
