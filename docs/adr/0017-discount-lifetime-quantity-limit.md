# ADR 0017: Per-customer lifetime discounted-quantity limit

## Status

Accepted

## Context

Product owners approved an optional per-customer lifetime quantity cap on discounts. PRC-03/PRC-05 already lock single-winner LINE then ORDER composition ([ADR 0015](0015-line-then-order-discount-composition.md)). ORD-03 creates Orders, freezes pricing snapshots, and reserves Inventory in one PostgreSQL **REPEATABLE READ** transaction. Without an explicit contract, implementers could reject over-limit carts, apply Redis counters, infer usage from OrderLine sums, or restore entitlement on return—any of which would break money evidence or concurrency.

Alternatives considered for over-limit behavior:

1. **Reject** the line or Order when requested quantity exceeds remaining entitlement.
2. **Partial discount**: apply the discount only to the remaining eligible quantity; purchase the rest at normal unit price.
3. **No discount**: if remaining entitlement is insufficient for the full line quantity, apply zero discount to the whole line.

Alternatives considered for persistence:

1. **Aggregate-only** consumed quantity per discountId and userId.
2. **Event/ledger-only** append-only consume/release records with derived totals.
3. **Aggregate + immutable usage records** (recommended).

## Decision

### Scope

1. V1 lifetime quantity caps apply **only** to PRODUCT LINE discounts (`DiscountTarget.PRODUCT`). CATEGORY and ORDER discounts must not accept a non-null lifetime quantity limit.
2. CATEGORY caps are deferred: a category winner can span many products, so quantity is ambiguous without a separate allocation policy.
3. ORDER caps are out of scope: ORDER discounts are money-based on `subtotalAfterLineDiscounts`, not unit quantity. Do not invent unit allocation for ORDER discounts.
4. PRC-03/PRC-05 single-winner and LINE-then-ORDER rules are unchanged. A lifetime-capped PRODUCT discount consumes usage **only when it is the applied LINE winner**. If a CATEGORY discount wins the line, no PRODUCT-cap consumption occurs for that line.

### Terminology

| Term                        | Meaning                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `maxQuantityPerCustomer`    | Optional configured lifetime cap on a PRODUCT Discount. `null` = unlimited (existing behavior).                    |
| `consumedQuantity`          | Durable non-negative units already consumed for `(discountId, userId)`.                                            |
| `remainingEligibleQuantity` | Derived: unlimited when cap is null; otherwise `max(0, maxQuantityPerCustomer - consumedQuantity)`.                |
| `requestedQuantity`         | Normalized Order-line quantity.                                                                                    |
| `discountedQuantity`        | Units that receive the LINE discount on this line (`0` through `requestedQuantity`).                               |
| `nonDiscountedQuantity`     | Derived: `requestedQuantity - discountedQuantity`.                                                                 |
| Consumption                 | Atomic increment of `consumedQuantity` by `discountedQuantity` when the Order successfully creates.                |
| Release                     | Atomic decrement of `consumedQuantity` by that Order's consumed discounted quantity on pre-`SHIPPED` cancellation. |

Do not use unexplained "allowance" as a persistence concept name.

### Over-limit and partial-discount math

V1 accepts **option 2 (partial discount)**. Exceeding remaining entitlement must **not** reject the purchase.

For a PRODUCT LINE winner with a non-null cap:

- `discountedQuantity = min(requestedQuantity, remainingEligibleQuantity)`.
- `nonDiscountedQuantity = requestedQuantity - discountedQuantity`.
- Discount calculation base for that line is `unitPrice * discountedQuantity` (not the full line base).
- PERCENT and FIXED PRC-03 rules apply to that reduced base (`floor` percent; FIXED capped by the reduced base).
- `grossLineTotal` remains `unitPrice * requestedQuantity`.
- `lineDiscountAmount` is the discount on the discounted base only.
- `finalLineTotal = grossLineTotal - lineDiscountAmount`.
- ORDER composition still runs on the sum of `finalLineTotal` after all lines (ADR 0015 unchanged).

Example: unit price `100000`, quantity `5`, 20% PRODUCT discount, `discountedQuantity = 3` yields gross `500000`, discount `60000`, final `440000`.

When remaining entitlement is `0`, a capped PRODUCT discount is **not LINE-eligible** for winner selection (so a CATEGORY candidate may still win under existing precedence). Unlimited (`null`) caps never reduce quantity and never remove eligibility by themselves.

### Lifecycle

1. **Consume** atomically on successful Order create, in the same PostgreSQL transaction as the frozen pricing snapshot and Inventory reservation.
2. **Release** on cancellation before `SHIPPED`, in the same transaction as Order cancel + Inventory `releaseForOrder`.
3. Once the Order reaches `SHIPPED`, consumed discounted quantity remains consumed.
4. **Returns do not restore** lifetime entitlement in V1. ORD-07 must not infer restoration from `RETURNED`/restock. Any future restore policy needs a separate explicit business decision.
5. Deactivate/reactivate of the same Discount row (`discountId`) retains the same lifetime usage. Lowering `maxQuantityPerCustomer` below already-consumed quantity yields `remainingEligibleQuantity = 0` without rewriting history.

### Persistence and concurrency

PostgreSQL is the sole correctness authority. Redis, cache, BullMQ, and distributed locks must not authorize entitlement.

Preferred V1 model: **aggregate + immutable usage records**

- `DiscountCustomerUsage` aggregate keyed by `(discountId, userId)` holding `consumedQuantity` (CHECK `>= 0`).
- Append-only `DiscountUsageRecord` rows for `CONSUME` / `RELEASE` with `orderId`, `discountId`, `userId`, `quantity`, and uniqueness so the same Order cannot double-consume or double-release.
- OrderLine snapshot stores explicit `discountedQuantity` (and keeps money/applied-discount evidence) so historical partial discount is reconstructable without reading mutable usage tables.

Concurrency: lock usage aggregates with `SELECT ... FOR UPDATE` in **sorted `discountId` order** inside the ORD-03 RR transaction **after** idempotency replay/conflict and **before** Inventory locks. Upsert/update aggregates and insert usage records in that same transaction. Do not use application-level read-check-write without row locks. Do not authorize caps by summing historical OrderLines.

### Canonical lock / create ordering

```text
PostgreSQL REPEATABLE READ transaction
  → Order create idempotency advisory lock / transition conditional Order UPDATE
  → (create) Commerce policy snapshot read (no policy row locks)
  → (create) User/Region/Product/Discount snapshot reads as today
  → DiscountCustomerUsage FOR UPDATE sorted by discountId
  → price with remainingEligibleQuantity → persist Order/OrderLine snapshots
    including discountedQuantity → append CONSUME records → update aggregates
  → Inventory orderId advisory lock
  → Inventory rows FOR UPDATE sorted by productId
  → Reservation rows / quantity mutation + ledger
  → commit
```

Cancel before ship:

```text
  → conditional Order UPDATE to CANCELLED
  → RELEASE usage records + decrease aggregates (from this Order's consume evidence)
  → Inventory releaseForOrder (existing lock order)
  → commit
```

### Idempotency

- Order create replay (same user + idempotency key + payload) returns the existing Order and must not insert a second CONSUME or re-increment aggregates.
- Cancel replay must not double-RELEASE.
- Usage-record uniqueness enforces these invariants even under concurrent retries.

## Consequences

- DLU-02 implements schema, Admin DTO fields, PRC-05 partial-quantity integration, ORD-03 consume, ORD-05 release, snapshot columns, and PostgreSQL race tests under this contract.
- Existing null-cap PRODUCT discounts and all CATEGORY/ORDER discounts remain behaviorally unchanged.
- Historical money evidence remains reconstructable from OrderLine snapshots even after Discount mutation or usage release.
- ORD-07 return work stays inventory/restock-focused and must not silently restore discount entitlement. Canonical return semantics: [ADR 0024](0024-order-returns-bulk-transitions-and-dispatch-board.md).
