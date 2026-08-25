# Deferred settlement tracking

EggShip V1 has no payment gateway. The approved requirement is operational tracking after delivery: an Admin assigns a due date, registers externally received proof through the existing Media library, and tracks open/overdue/settled work. Implementation is gated by `SET-01`; unresolved business choices below must not be invented.

## Approved boundaries

- Every customer Order is eligible; there is no customer enablement or credit flag in V1.
- `dueAt` is assigned by Admin only after the Order reaches `DELIVERED`.
- Receipt/proof originates outside EggShip and is registered by Admin.
- Media owns object bytes and metadata. Settlement stores references only.
- PostgreSQL is authoritative. No provider, card, bank credential, transaction id, balance, refund, or accounting subsystem is introduced.
- Settlement state remains separate from the Order state machine. It does not block delivery or rewrite Order status.

## Recommended bounded module

Introduce `src/modules/settlements` with a one-to-one settlement aggregate rooted by `orderId`. Do not add a cluster of nullable settlement columns to `Order`; a separate model owns its lifecycle, queries, permissions, and future audit events while Orders continues to own delivery state.

Conceptual direction only:

```text
OrderSettlement
  id
  orderId unique, FK RESTRICT
  status OPEN | SETTLED
  dueAt timestamptz
  settledAt nullable timestamptz
  createdAt / updatedAt
  createdByAdminId / settledByAdminId

SettlementReceipt
  id
  settlementId FK CASCADE or RESTRICT per correction policy
  mediaId FK RESTRICT
  attachedAt
  attachedByAdminId
```

`overdue` is derived at query time as `dueAt < now AND status != SETTLED`; it is not a stored status. `dueAt` is an absolute UTC instant at persistence/API boundaries. Clients may display it in Tehran time, but no business-day interpretation is implied.

## Lifecycle recommendation — pending SET-01 approval

- Creating the settlement record and assigning `dueAt` is one explicit command allowed only for a currently `DELIVERED` Order.
- Receipt attachment may occur before or after `dueAt`.
- Receipt attachment should not itself settle the Order; a separate explicit Admin command sets `SETTLED` and `settledAt`. This preserves review intent and prevents an arbitrary upload from becoming financial confirmation.
- Settling should require at least one valid attached receipt if product operations confirm that proof is mandatory.
- V1 should prefer one receipt for the narrowest model, implemented through the join model so a later approved multi-receipt extension is additive.

**Human decision required:** one versus multiple receipts; whether a receipt is mandatory to settle; whether attachment auto-settles or explicit confirmation is required; whether due dates may be corrected, settlements reopened, receipts detached/replaced, and how those corrections are audited.

## Media rules

- Validate that a referenced Media row exists and is an allowed proof type before attachment; never accept arbitrary/unowned storage keys.
- `SettlementReceipt.mediaId` uses `ON DELETE RESTRICT`. Media deletion returns the existing referenced-media conflict contract rather than orphaning proof.
- The current Media library accepts image/jpeg, image/png, and image/webp. PDF proof is not approved by CAT-04 and must not be silently added by Settlement.
- Settlement never stores binary bytes or copies a host-specific URL.

## Admin list and authorization

The dedicated Admin list follows standard pagination and strict query validation. Recommended explicit filters: settlement `status`, derived `overdue`, `dueFrom`/`dueTo`, and `orderId`; recommended sort allowlist: `dueAt`, `createdAt`, `settledAt` with deterministic id tie-breaks. Search fields require evidence and must not become a dynamic query DSL.

Use dedicated permissions such as `SETTLEMENT_READ` and `SETTLEMENT_MANAGE`, granted explicitly in the central role policy. `SUPER_ADMIN` has no bypass. **Human decision required:** which operational Admin roles receive each permission.

Admin routes use both guards and permission metadata. Order identity comes from the route, but the service verifies the Order exists and is delivered. Customer settlement endpoints are not approved. Generic Admin errors must not leak customer data to unauthorized callers.

## Concurrency and idempotency

- `UNIQUE(orderId)` prevents duplicate settlement aggregates.
- Assign/correct/settle commands use conditional PostgreSQL writes or a locked settlement row; application read-check-write alone is insufficient.
- Creation checks the delivered Order and creates the settlement in one transaction, following Orders-before-Settlement lock order.
- Receipt attachment has a database uniqueness rule appropriate to the approved receipt count and an idempotency identity so retries do not duplicate links.
- Concurrent settle/receipt/correction commands serialize on the settlement row and either replay safely or return a stable conflict.
- Redis/BullMQ are not correctness authorities. Future overdue reminders use durable outbox semantics and must not create a second settlement status.

## Audit, notifications, and analytics

Audit candidates: due date assigned/changed, receipt attached/detached/replaced, marked settled, reopened, and permission denial. Audit payloads contain ids and safe field deltas, never file bytes, raw filenames, or bank/card data.

Notifications are not approved merely because a due date exists. Any reminder/escalation type, recipient, cadence, and Tehran scheduling rule requires an explicit notification task and transactional outbox integration.

Analytics may later count open/overdue/settled records from PostgreSQL. No revenue-recognition or accounting metric follows automatically from `SETTLED`.

## Unresolved

All items marked human decision required, plus stable error codes/messages, correction/reopen policy, audit retention, reminder behavior, and whether any customer-facing read surface is required.
