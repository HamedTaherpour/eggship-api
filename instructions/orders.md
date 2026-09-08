# Orders

EggShip V1 has **no online payment gateway**. Warehouse/operations ships goods; receipt/proof originates outside EggShip. Approved deferred-settlement tracking is planned as a separate bounded module ([settlement.md](settlement.md)); it is not online payment processing and does not add payment-dependent Order states or transitions ([ADR 0014](../docs/adr/0014-order-state-machine-and-transition-authorization.md)). Do not introduce gateway, card, checkout-payment, provider transaction-id, refund, or accounting models.

## Historical snapshot principle

Orders are durable business records. **Historical display must not depend on mutable Product, User/profile, Region, Discount, or discount-usage state.**

At order creation the backend persists immutable snapshots:

| Field                                                                                                        | Source at creation                          | Mutable later? |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | -------------- |
| `OrderLine.productName`                                                                                      | `Product.name`                              | No             |
| `OrderLine.unitPrice`                                                                                        | `Product.price` (integer Toman)             | No             |
| `OrderLine.quantity` / `discountedQuantity`                                                                  | requested qty; DLU partial-discount qty     | No             |
| `OrderLine.grossLineTotal`                                                                                   | server `unitPrice × quantity`               | No             |
| `OrderLine.lineDiscountAmount` / `finalLineTotal`                                                            | PRC-05 LINE composition (possibly partial)  | No             |
| `OrderLine` applied LINE discount columns                                                                    | PRC-05 `appliedLineDiscount`                | No             |
| `Order.customerPhone`                                                                                        | canonical `User.phone`                      | No             |
| `Order.regionName`                                                                                           | `Region.name`                               | No             |
| `Order.grossSubtotal` / `lineDiscountTotal` / `subtotalAfterLineDiscounts` / `orderDiscountAmount` / `total` | PRC-05 order aggregates                     | No             |
| `Order.pricingEvaluatedAt`                                                                                   | PRC-05 `evaluatedAt` (shared with COM-03)   | No             |
| `Order.commercePolicyRevision`                                                                               | COM-03 observed `CommerceSettings.revision` | No             |
| `Order` applied ORDER discount columns                                                                       | PRC-05 `appliedOrderDiscount`               | No             |

`OrderLine.productId` and `Order.regionId` retain traceability (`ON DELETE RESTRICT`). Applied discount columns store historical evidence **without FK** to `Discount` — deactivated or changed Discount rows must not be required to reconstruct totals. `discountedQuantity` is required snapshot evidence for partial lifetime eligibility ([ADR 0017](../docs/adr/0017-discount-lifetime-quantity-limit.md); DLU-02). Do not infer discounted units later from mutable usage aggregates alone.

Repositories must not expose generic updates for snapshot fields. ORD-02 owns explicit status/lifecycle mutations.

## Server-authoritative money

Order creation (ORD-03 `OrderCreationService.createOrder`) receives only trusted `USER` actor identity, `regionId`, idempotency key, and `productId` + `quantity` lines. The backend:

1. Normalizes/collapses lines (same V1 policy as Inventory / PRC-05).
2. Loads `customerPhone` and `regionName` server-side inside the create transaction (never from the client).
3. Prices via `OrderPricingService.priceOrderLines` inside the create transaction.
4. Persists trusted snapshots through `OrderRepository.createWithTrustedSnapshots`.
5. Reserves via `InventoryService.reserveForOrder` in the same transaction.

**Clients must never submit authoritative `unitPrice`, line totals, discount ids, product names, phone, or order totals.**

- Currency: **integer Toman** ([ADR 0010](../docs/adr/0010-integer-toman-money.md)).
- `OrderLine.unitPrice`: PostgreSQL `INTEGER` (int4), same bounds as `Product.price`.
- Gross and discounted money columns use PostgreSQL `BIGINT` / Prisma `BigInt` ([ADR 0013](../docs/adr/0013-order-historical-snapshots.md)).
- Use `src/modules/orders/domain/order-money.ts` and `order-money-invariants.ts` for safe bigint math and reconciliation; never use floating point.
- **Discount composition** is owned by Pricing PRC-05 ([ADR 0015](../docs/adr/0015-line-then-order-discount-composition.md), [pricing.md](pricing.md)). ORD-03 persists the PRC-05 snapshot without re-deriving discount math.

### Money invariants (persisted)

Per line:

- `grossLineTotal = unitPrice × quantity`
- `finalLineTotal = grossLineTotal − lineDiscountAmount`

Per order:

- `grossSubtotal = Σ grossLineTotal`
- `lineDiscountTotal = Σ lineDiscountAmount`
- `subtotalAfterLineDiscounts = Σ finalLineTotal`
- `total = subtotalAfterLineDiscounts − orderDiscountAmount`

No negatives. Application service owns cross-line aggregate equality; DB CHECKs cover per-row facts where practical.

### PRC-05 → ORD-03 snapshot contract

| Area  | Fields                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line  | `productId`, `productName`, `unitPrice`, `quantity`, `discountedQuantity`, `grossLineTotal`, `lineDiscountAmount`, `finalLineTotal`, applied LINE discount evidence |
| Order | `grossSubtotal`, `lineDiscountTotal`, `subtotalAfterLineDiscounts`, `orderDiscountAmount`, `total`, applied ORDER discount evidence, `pricingEvaluatedAt`           |

- Transaction isolation: when ORD-03 calls `priceOrderLines({ tx })` inside the create transaction, that transaction **must** use PostgreSQL **REPEATABLE READ** (or equivalent) so Product and Discount reads share one snapshot. ORD-03 uses `TransactionRunner.runRepeatableRead` for the full create (price → persist → reserve). Concurrent Inventory updates under RR can raise serialization failures; `OrderCreationService` applies a bounded retry before surfacing a stable create-conflict message.

JSON: totals within `Number.MAX_SAFE_INTEGER` may serialize as numbers; larger exact values serialize as decimal strings — never floats.

## Order creation (ORD-03 / ORD-03A)

Application entry: `OrderCreationService.createOrder`.

Customer HTTP (ORD-03A): `POST /api/v1/orders` (`Orders_create`).

Customer read HTTP (ORD-04): `GET /api/v1/orders` (`Orders_list`) and `GET /api/v1/orders/:id` (`Orders_get`).

- Authenticated `USER` only (`AccessTokenGuard` + `requireCustomerOwnerId`). Admin subjects receive `AUTH_FORBIDDEN`.
- Owner scope derived exclusively from the authenticated principal — never from query/body/path beyond the order id.
- List: CAT-01 pagination; optional `status`, inclusive `createdFrom`/`createdTo`; sort allowlist `createdAt`/`total`/`status` (default `createdAt` desc, stable `id` tie-break); no search; unknown query params rejected.
- List items are summary snapshots (no line items). Detail returns persisted line snapshots and lifecycle timestamps; does not join current Product/Discount state.
- Missing or other-owner detail → `ORDER_NOT_FOUND` (404), same shape. Wrong subject type → `AUTH_FORBIDDEN` (403).

Admin Order HTTP (ORD-06): `GET /api/v1/admin/orders`, `GET /api/v1/admin/orders/:id`, and explicit `POST` commands at `/confirm`, `/cancel`, `/ship`, and `/deliver`.

- Admin list uses CAT-01 pagination with optional `status`, `regionId`, inclusive `createdFrom`/`createdTo`, and the explicit sort allowlist `createdAt`, `total`, `status`, `deliveryAt` (default `createdAt` descending with stable `id` tie-break). It intentionally has no free-text search and returns summary snapshots only.
- Admin reads and commands require `ORDER_READ` or `ORDER_TRANSITION`, respectively, through `AccessTokenGuard` + `PermissionGuard`. `ORDER_OPS` and `SUPER_ADMIN` can operate; `WAREHOUSE` is read-only; `USER` is forbidden.
- Admin detail and mutation responses use persisted historical snapshots and include operational cancellation metadata, but omit idempotency payload/hash, commerce-policy metadata, Prisma entities, and infrastructure fields. All Admin Order responses are `Cache-Control: no-store`.
- Admin command actor identity is derived from the authenticated Admin principal. Commands delegate to the ORD-02 transition service; they do not add a generic status update or a second state machine. Cookie-authenticated mutations remain subject to the shared AUTH-10 CSRF guard.
- Success responses use `Cache-Control: no-store`.
- Body: `{ regionId, lines: [{ productId, quantity }] }` only. No `userId`, actor, phone, prices, names, discount ids, totals, status, or commerce-policy fields.
- Header: required UUID `Idempotency-Key` (stable `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID`).
- Actor/userId bound from the authenticated principal only.
- Success: `201` on create, `200` on identical idempotent replay; `Cache-Control: no-store`.
- Cookie-authenticated browser requests to ORD-03A remain subject to the shared AUTH-10 CSRF guard.

Conceptual input:

- trusted `USER` actor (`actor.id` = `userId`)
- `idempotencyKey` (UUID)
- `regionId`
- lines: `{ productId, quantity }[]`

Flow in one RR transaction:

1. Advisory-lock create idempotency scope `(userId, idempotencyKey)`
2. Replay or conflict on existing Order for that key + payload hash
3. Evaluate one coherent Commerce policy revision from the same REPEATABLE READ snapshot (COM-03)
4. Resolve User phone / Region name **via the same opaque `TransactionContext`** (ORD-03A)
5. Lock `DiscountCustomerUsage` rows for relevant PRODUCT discounts (`FOR UPDATE`, sorted `discountId`) and price with `remainingEligibleQuantity` (DLU-02 / [ADR 0017](../docs/adr/0017-discount-lifetime-quantity-limit.md))
6. Persist trusted snapshots (including `discountedQuantity`), `commercePolicyRevision`, append CONSUME usage records, and update usage aggregates
7. Reserve Inventory through `reserveForOrder(orderId, normalized lines, USER actor, tx)`
8. Commit — status is always `PENDING_REVIEW`

Failure at any step rolls back policy evaluation side effects, discount usage, Order, lines, and reservation. No Order without reservation; no reservation or discount-usage consumption without Order.

COM-03 persists the accepted `commercePolicyRevision` and reuses the shared database evaluation instant as `pricingEvaluatedAt`; it does not copy regular hours, minimum quantity, override fields, or Admin metadata onto Order. Commerce policy reads do not require pessimistic row locks: settings and relevant date overrides join the outer REPEATABLE READ transaction so one committed snapshot governs the attempt. See [ADR 0016](../docs/adr/0016-commerce-order-acceptance-policy.md) and [commerce-policy.md](commerce-policy.md).

User and Region authoritative reads join the outer create transaction through `UserRepository.findById` / `RegionRepository.findById` optional `TransactionContext` parameters (ORD-03A). Inactive User or inactive/missing Region → `ORDER_INVALID_USER` / `ORDER_INVALID_REGION`.

### Idempotency

`UNIQUE(userId, idempotencyKey)` plus `idempotencyPayloadHash` (SHA-256 of normalized `regionId` + collapsed lines).

- Same user + key + same logical payload → return the existing Order (no second reserve)
- Same key + materially different payload → `ORDER_IDEMPOTENCY_CONFLICT`
- Concurrent duplicates serialize on the advisory lock before Inventory side effects
- A waiter that receives a structured unique violation under RR may read again only after rollback. Replay/conflict requires a fresh `(userId, idempotencyKey)` row; if none exists, preserve the original database failure.
- Retry only exact Prisma `P2034` / PostgreSQL `40001` serialization failures, with bounded attempts. Message text alone is never a retry signal.

Do not rely on frontend button disabling.

### Visibility / sale eligibility

Inactive Product or Product under inactive Category cannot be newly ordered (`PRODUCT_NOT_FOUND` / `ORDER_INVALID_PRODUCT` mapping). Existing historical Orders remain unaffected. Ownership of visibility rules remains with PRC-05 / CAT-06.

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
DELIVERED      → RETURNED   (ORD-07 explicit completion only)
```

`DELIVERED → RETURNED` is implemented in ORD-07 only ([ADR 0024](../docs/adr/0024-order-returns-bulk-transitions-and-dispatch-board.md)). ORD-02 does not implement it.

**Terminal states:** `CANCELLED`, `RETURNED`. `DELIVERED` is not strictly terminal (ORD-07 may transition to `RETURNED`).

Do not encode the state machine in CHECK constraints.

## Transition commands

Transitions are **explicit application commands** — not a generic status PATCH and not a public `transition(orderId, toStatus)` API:

| Command                        | From → to                                     | Inventory                             |
| ------------------------------ | --------------------------------------------- | ------------------------------------- |
| `confirmOrder`                 | `PENDING_REVIEW` → `CONFIRMED`                | none                                  |
| `cancelPendingOrderByCustomer` | `PENDING_REVIEW` → `CANCELLED` (owner-scoped) | `releaseForOrder`                     |
| `cancelOrderByAdmin`           | `PENDING_REVIEW` or `CONFIRMED` → `CANCELLED` | `releaseForOrder`                     |
| `shipOrder`                    | `CONFIRMED` → `SHIPPED`                       | `shipForOrder`                        |
| `deliverOrder`                 | `SHIPPED` → `DELIVERED`                       | none                                  |
| `recordOrderReturn` (ORD-07)   | none (Order stays `DELIVERED`)                | `returnToStock` for sellable qty only |
| `completeOrderReturn` (ORD-07) | `DELIVERED` → `RETURNED`                      | none                                  |

HTTP, `AccessTokenGuard`, `PermissionGuard`, and BOLA mapping belong to ORD-05/ORD-06. Commands accept a trusted `USER`/`ADMIN` actor (UUID id). Customer cancel uses `actor.id` as `userId` and cannot cancel `CONFIRMED`. Confirm/ship/deliver/admin-cancel require an `ADMIN` actor at the command boundary; they do not check `ORDER_TRANSITION` themselves.

Canonical legal pairs live in `src/modules/orders/domain/order-transitions.ts`, including the ORD-07 `DELIVERED -> RETURNED` completion edge.

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

| Field         | Set when                                                                  |
| ------------- | ------------------------------------------------------------------------- |
| `confirmedAt` | first confirmation                                                        |
| `shippedAt`   | first shipment                                                            |
| `deliveredAt` | first delivery                                                            |
| `cancelledAt` | first cancellation                                                        |
| `returnedAt`  | first explicit return-process completion (`DELIVERED → RETURNED`; ORD-07) |

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

## Idempotent replay (transitions)

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

All Orders flows that mutate Inventory and/or discount usage run in **one PostgreSQL transaction**. Lock order:

```text
PostgreSQL transaction
  → Order create idempotency advisory lock (ORD-03) / conditional Order row UPDATE (transitions)
  → DiscountCustomerUsage FOR UPDATE sorted by discountId (DLU-02 create consume / pre-ship cancel release)
  → Inventory orderId advisory lock
  → Inventory rows FOR UPDATE sorted by productId
  → Reservation rows in the same order
  → quantity mutation + ledger
  → commit
```

Every Orders+Inventory(+discount usage) flow must use this order. Discount usage locks sit after Order identity / transition success and before Inventory locks so concurrent same-user discount races serialize without crossing Inventory lock order.

For ORD-07 return recording with sellable restock, Slice 2 must use the approved extension: lock the Order row first (`FOR UPDATE`), validate the delivered state, enforce each line's cumulative returned quantity while that Order lock is held, then take the Inventory `orderId` advisory lock, lock Inventory rows in sorted `productId` order, and append the return-to-stock effects before commit. Return persistence primitives join the caller-owned transaction; they do not open nested transactions or claim cumulative safety from an unlocked pre-read.

### Lifetime discounted-quantity lifecycle (DLU-01)

- **Create:** consume `discountedQuantity` for each applied capped PRODUCT LINE winner in the same RR transaction as pricing snapshot + reservation ([ADR 0017](../docs/adr/0017-discount-lifetime-quantity-limit.md)).
- **Cancel before `SHIPPED`:** release that Order’s consumed discounted quantity in the same transaction as Inventory `releaseForOrder` (ORD-05 + DLU-02).
- **`SHIPPED` and later:** no release.
- **`RETURNED` / restock (ORD-07):** must not restore lifetime entitlement in V1.
- Idempotent create/cancel replay must not double-consume or double-release (usage-record uniqueness + Order idempotency).

Admin Inventory errors during ship/cancel may surface as Inventory errors after rollback. Customer cancel maps `INVENTORY_RESERVATION_NOT_FOUND` and `INVENTORY_RESERVATION_CONFLICT` to `ORDER_INVALID_TRANSITION` with the customer-cancel message. Other Inventory `ApplicationError`s on that path are treated as internal failures (not remapped to `ORDER_INVALID_TRANSITION` and not returned as Inventory codes or details). Unexpected persistence failures are not remapped.

On create, insufficient stock surfaces as stable Inventory `INVENTORY_INSUFFICIENT_STOCK` after full rollback.

## Inactive source entities

- Inactive **Product** does not block fulfillment of an already-created/reserved order.
- **Region** rename/deactivation does not change historical snapshot columns or block fulfillment.
- User disable after order creation does not auto-cancel; see authorization table above.

## Returns, bulk transitions, and dispatch (ORD-07)

Canonical semantics: [ADR 0024](../docs/adr/0024-order-returns-bulk-transitions-and-dispatch-board.md).

### Return aggregate

- V1 supports **partial line-level returns** with **multiple return events** per Order.
- Durable history lives in a dedicated return aggregate (`OrderReturn` + `OrderReturnLine` conceptually — not on `Order` alone).
- Each return line records **`sellableQuantity`** and **`damagedQuantity`**.
- Every return creation requires a trimmed **Human-entered reason** (no enum). Validation bounds are an implementation decision; align with Admin cancel reason (**1–500** characters) unless review chooses otherwise.
- Return creation requires **`ORDER_TRANSITION`**; do not introduce `ORDER_RETURN`.
- Return creation uses **retry-safe idempotency** (same key + payload → replay; same key + different payload → conflict).
- Cumulative returned quantity per **OrderLine** must never exceed shipped/eligible quantity; multiple returns per line are allowed until remaining eligible quantity is zero.
- **`sellableQuantity`** restocks via Inventory `returnToStock` (`onHand += qty`, `RETURN_TO_STOCK` ledger). **`damagedQuantity`** does not change `onHand` or `reserved` (stock already left at `SHIPPED`).
- Returns do **not** mutate pricing snapshots, `Order.total`, discount usage, or Settlement ([ADR 0017](../docs/adr/0017-discount-lifetime-quantity-limit.md), [ADR 0018](../docs/adr/0018-deferred-settlement-lifecycle.md)).
- **`RETURNED` does not mean refunded.** Refund/credit/carrier/customer-initiated return remain out of scope.

### Two return operations

| Operation                    | Effect                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| **Record return/inspection** | Persist return event + optional restock; Order may remain **`DELIVERED`**      |
| **Complete return process**  | Explicit Admin completion → **`DELIVERED → RETURNED`**; sets `returnedAt` once |

Do not infer completion from partial/full return quantity or the mere existence of return records.

Completion replay follows normal transition idempotency (preserve `returnedAt`; append **`order.returned`** audit only on first success). Return aggregate + `InventoryLedger` provide inspection history; no per-return AuditLog is approved by default ([ADR 0024](../docs/adr/0024-order-returns-bulk-transitions-and-dispatch-board.md)).

### Bulk transitions (V1)

Bulk supports **SHIP** and **DELIVER** only — not CONFIRM, CANCEL, or RETURN.

- Each Order is an **independent transactional unit** (partial success; no whole-batch PostgreSQL transaction).
- HTTP **200** with explicit per-order successes/failures and stable error codes (not HTTP 207).
- Reuse ORD-02 per-order transition invariants and per-order AuditLog (`order.shipped`, `order.delivered` — no bulk audit action).
- Every item is individually authorized and transition-validated.
- Implementation must propose a conservative batch maximum (recommended starting point: **50**).

### Dispatch board (V1 read model)

- Dedicated Admin read contract: `GET /api/v1/admin/orders/dispatch` — **not** a persisted Dispatch domain and **not** a proxy of the generic Admin Order list.
- **`ORDER_READ`** only; no `DISPATCH_READ`. Ordinary reads do not write AuditLog.
- Includes **`CONFIRMED`** and **`SHIPPED`** only; optional filters are `regionId` and pipeline `status` (`CONFIRMED` | `SHIPPED`). Unknown query keys are rejected.
- Results are **grouped by Order Region snapshot** (`regionId` / `regionName`). Groups are ordered by `regionName` ASC, then `regionId` ASC.
- Within each group (and for the bounded global fetch): `deliveryAt` ASC with **nulls last**, then `createdAt` ASC, then `id` ASC.
- Response includes a small operational **summary** (`ordersCount`, `confirmedCount`, `shippedCount`, `regionCount`) plus explicit bound metadata (`limit`, `truncated`, `matchedCount`).
- V1 bound: **100** Orders (`ADMIN_DISPATCH_ORDER_LIMIT`, aligned with CAT-01 `MAX_PAGE_SIZE`). Truncation is never silent.
- No carrier/GPS/route optimization; no new address fields. Shipping address snapshots remain deferred (MIG-01).

## `RETURNED` (canonical summary)

Coarse order-level outcome meaning the **operational return process has been explicitly completed** ([ADR 0024](../docs/adr/0024-order-returns-bulk-transitions-and-dispatch-board.md)). **ORD-07** owns return inspection/recording and explicit completion as separate operations. `RETURNED` never implies automatic inventory restock, refund, or settlement change. ORD-02 does not implement `DELIVERED → RETURNED`. ORD-07 must **not** restore lifetime discount entitlement from return/restock; that remains an explicit future business decision ([ADR 0017](../docs/adr/0017-discount-lifetime-quantity-limit.md)). `RETURNED` also never settles, reopens, deletes, or otherwise mutates deferred-settlement state; an existing settlement remains independently recorded and return/refund/credit adjustments are future policy ([ADR 0018](../docs/adr/0018-deferred-settlement-lifecycle.md)).

## Order error codes

Keep a small stable set:

- `ORDER_NOT_FOUND`
- `ORDER_INVALID_TRANSITION`
- `ORDER_CANCELLATION_REASON_REQUIRED`
- `ORDER_INVALID_INPUT`
- `ORDER_INVALID_MONEY`
- `ORDER_INVALID_USER` / `ORDER_INVALID_REGION` / `ORDER_INVALID_PRODUCT`
- `ORDER_IDEMPOTENCY_CONFLICT`

Do not add per-command status-error explosion. Pricing unavailability maps to `ORDER_INVALID_PRODUCT` (displayable product-not-found). Inventory shortage may surface as Inventory codes on the create path.

## Mutable vs immutable Order fields

**Immutable after creation:** `id`, `userId`, customer/region/line/money/discount snapshots (including `discountedQuantity`), `pricingEvaluatedAt`, `idempotencyKey` / `idempotencyPayloadHash`, `createdAt`.

**Mutable through explicit domain transitions (ORD-02+):** `status`, lifecycle timestamps (`confirmedAt`, `shippedAt`, `deliveredAt`, `returnedAt`, `deliveryAt`), cancellation metadata (`cancelledAt`, `cancelReason`).

Return inspection workflow persistence belongs to ORD-07 — do not model full return semantics on `Order` in ORD-01/ORD-02/ORD-03.

## Customer cancellation HTTP (ORD-05)

`POST /api/v1/orders/:id/cancel` is an explicit customer command. It accepts
an empty JSON object only; ownership and actor identity come exclusively from
the authenticated `USER` principal. Missing and other-owner Orders both map to
`ORDER_NOT_FOUND`. A customer may cancel only `PENDING_REVIEW`; an already
`CANCELLED` Order is an idempotent replay, while all other states map to
`ORDER_INVALID_TRANSITION`.

The command returns the customer-safe Order detail shape and `Cache-Control:
no-store`. It never accepts or exposes a cancellation reason, Inventory data,
discount usage data, or idempotency internals. The Orders-owned transaction
conditionally transitions the Order, then releases DLU usage and Inventory
reservations through their application contracts. Any failure rolls back the
Order transition and all release records. Cookie-authenticated browser use is
still subject to the shared AUTH-10 CSRF guard.

## Inventory boundary

- `InventoryReservation.orderId` remains an **opaque UUID** with **no FK** to `Order`.
- V1 collapses duplicate `productId` lines before persistence: `UNIQUE(orderId, productId)` aligns with Inventory reservation identity.

## Deferred snapshot extensions (MIG-01 / profile tasks)

No in-repo legacy Order contract exists yet (`MIG-01` PLANNED). The following remain explicitly deferred rather than invented:

- Shipping/delivery **address** snapshot columns (User profile address fields do not exist — AUTH-07 is phone-only).
- Store name, manager name, coordinates, and profile `regionId` FK.
- Human-readable order numbers/codes.
- Order notes, invoice metadata.
- Order-level payment/settlement snapshot columns (approved deferred-settlement tracking lives in the separate Settlement module instead — [settlement.md](settlement.md), [ADR 0018](../docs/adr/0018-deferred-settlement-lifecycle.md)).

When profile/address support lands, Orders must snapshot address at creation — **never reference a mutable User address directly** for historical display.

## Module layout

`src/modules/orders/` — domain types, money helpers, `OrderCreationService` (`createOrder`), `OrderReadService` (customer and Admin list/detail plus Admin Dispatch board), `OrdersController` (customer HTTP), `AdminOrdersController` (permissioned Admin list/detail/dispatch/confirm/cancel/ship/deliver/bulk-transition/returns), `OrderTransitionService` (confirm/cancel/ship/deliver/complete-return), `BulkOrderTransitionService`, `OrderReturnService`, `OrderRepository` (`createWithTrustedSnapshots`, Admin/owner reads, dispatch list, idempotency lookup/lock, closed conditional status updates), and `OrderReturnRepository` (durable return aggregate, idempotency proof, cumulative quantity read, and transaction-compatible lock primitives). Orders imports Pricing + Inventory application contracts; Inventory must not import Orders.

## Related ADRs

- [0010 — Integer Toman money](../docs/adr/0010-integer-toman-money.md)
- [0012 — Inventory quantity / ledger / concurrency](../docs/adr/0012-inventory-quantity-ledger-concurrency.md)
- [0013 — Order historical snapshots](../docs/adr/0013-order-historical-snapshots.md)
- [0014 — Order state machine and transition authorization](../docs/adr/0014-order-state-machine-and-transition-authorization.md)
- [0015 — V1 LINE then ORDER discount composition](../docs/adr/0015-line-then-order-discount-composition.md)
- [0016 — Commerce order-acceptance policy](../docs/adr/0016-commerce-order-acceptance-policy.md)
- [0017 — Per-customer lifetime discounted-quantity limit](../docs/adr/0017-discount-lifetime-quantity-limit.md)
- [0018 — Deferred-settlement lifecycle](../docs/adr/0018-deferred-settlement-lifecycle.md)
- [0024 — Order returns, bulk transitions, and dispatch board](../docs/adr/0024-order-returns-bulk-transitions-and-dispatch-board.md)
