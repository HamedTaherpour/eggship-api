# ADR 0018: Deferred-settlement lifecycle

## Status

Accepted

## Context

EggShip V1 has no online payment gateway ([ADR 0014](0014-order-state-machine-and-transition-authorization.md)). Warehouse/operations ships goods and customers pay later through channels outside EggShip. The product owner approved deferred settlement as an operational/back-office workflow, not payment processing: after an Order reaches `DELIVERED`, an Admin assigns a due date, registers externally received payment proof through the existing Media library ([ADR 0011](0011-media-object-storage-and-multi-upload.md)), and tracks open/overdue/settled work in dedicated Admin views. Every customer Order is eligible; there is no customer enablement or credit flag in V1.

SET-01 was BLOCKED on: one versus multiple receipts, receipt-versus-explicit-settle behavior, the receipt-required rule, correction/reopen/detach semantics, exact Admin role grants, and stable conflict/error semantics. This ADR records the accepted decisions so SET-02 can implement without inventing policy.

Alternatives considered:

1. **Settlement columns on `Order`** (rejected: mixes receivable tracking with the immutable fulfillment lifecycle and complicates permissions, operational queries, and audit; Orders must keep delivery state and money snapshots as their only concerns).
2. **Persisted `OVERDUE` status or scheduled overdue transitions** (rejected: overdue is exactly `dueAt < now AND status = OPEN`; deriving it at read time needs no scheduler and no second status source).
3. **Receipt join table supporting multiple receipts** (rejected for V1: the approved requirement is one receipt image; a join table is speculative infrastructure. A later approved multi-receipt rule is an additive migration).
4. **Receipt attachment auto-settles** (rejected: a receipt is externally submitted evidence; settlement completion is an explicit Admin confirmation, preserving review intent and preventing an arbitrary upload from becoming financial confirmation).
5. **Reopen/void correction workflow in V1** (deferred: no approved product requirement; corrections are a future explicit task).
6. **Persisted settlement amount** (rejected: `Order.total` is immutable ([ADR 0013](0013-order-historical-snapshots.md)) and settlement always represents the full total; duplicating it creates divergence risk).
7. **Granting settlement permissions to `WAREHOUSE`/`ORDER_OPS`** (deferred: no legacy capability evidence until MIG-01; V1 fails closed with a `SUPER_ADMIN`-only grant, matching the `COMMERCE_POLICY_MANAGE` precedent).

## Decision

### Bounded context and ownership

| Concern                                                      | Owner                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Fulfillment lifecycle, immutable totals/snapshots            | Orders ([ADR 0013](0013-order-historical-snapshots.md), 0014)     |
| Due date, completion state, receipt reference, overdue logic | Settlements (`src/modules/settlements`)                           |
| Receipt bytes and metadata                                   | Media ([ADR 0011](0011-media-object-storage-and-multi-upload.md)) |

Introduce a separate bounded module with a one-to-one `OrderSettlement` aggregate rooted by `orderId` (`UNIQUE`). Do not add settlement columns to `Order`. Settlement never mutates Order status; Order state transitions never mutate settlement state. Settlement reads Order identity/status/total read-only (through Orders-owned contracts or narrow joins that respect Order snapshot invariants); it never writes Order tables. Settlement stores Media references only — never bytes, `storageKey`, or host-specific URLs.

### Creation eligibility

- Creating the settlement and assigning `dueAt` is **one explicit Admin command**, allowed only for an Order whose current status is `DELIVERED`.
- No settlement for `PENDING_REVIEW`, `CONFIRMED`, `SHIPPED`, `CANCELLED`, or `RETURNED`. Missing Order answers `ORDER_NOT_FOUND`; any other status answers `SETTLEMENT_ORDER_NOT_DELIVERED`.
- The delivered-status check and the insert run in one PostgreSQL transaction with the Order verified before the settlement row is written (Orders-before-Settlement lock order).
- Delivery never implies payment state. Creating the settlement opens tracking; it asserts nothing about payment.

### Lifecycle and status

- Statuses: `OPEN` and `SETTLED` only. No third state.
- `OPEN → SETTLED` is the only transition, via the explicit settle command.
- `overdue` is **derived** at read time as `status = OPEN AND dueAt < now()`, using a database/server instant. It is never persisted, never a status value, and never produced by a scheduled job.

### Due-date semantics

- `dueAt` is required at creation and is an absolute UTC `timestamptz`. API boundaries use ISO 8601. Jalali/Tehran-local entry is an Admin UX concern; the backend stores and compares absolute instants only.
- A past `dueAt` is allowed (recording an already-agreed date). There is no "must be in the future" rule.
- `dueAt` is editable **only while `OPEN`**, through an explicit change-due-date command (audit candidate). It is immutable after `SETTLED`.
- Overdue comparison uses server/database now; a client never supplies the comparison instant.

### Receipt model

- **Exactly one current receipt** per settlement: a nullable `receiptMediaId` on `OrderSettlement` (FK → `Media` `ON DELETE RESTRICT`) plus `receiptAttachedAt` / `receiptAttachedByAdminId` provenance. No join table; a future approved multi-receipt rule is additive.
- Attachment is an explicit Admin command allowed only while `OPEN`. Attaching the already-attached Media is an idempotent no-op success; attaching different Media replaces the reference atomically. The replaced Media object becomes unreferenced; orphan/retention policy belongs to Media lifecycle (DATA-02) and no retention period is invented here.
- Attachment validates that the Media row exists (`MEDIA_NOT_FOUND`) and is an allowed proof type. The current Media library accepts only image/jpeg, image/png, and image/webp, so every existing row is eligible; **PDF proof is not approved** and must not be silently added by Settlement.
- Attachment never changes settlement status. The receipt triple (`receiptMediaId`, `receiptAttachedAt`, `receiptAttachedByAdminId`) is set together and is immutable after settlement.

### Settlement completion

- Settling is an explicit Admin command requiring `OPEN` status and a currently attached receipt; settling without a receipt answers `SETTLEMENT_RECEIPT_REQUIRED`.
- The command sets `settledAt` (server now) and `settledByAdminId`. Exactly one competing settle wins; replay on an already `SETTLED` settlement is idempotent success and rewrites nothing.
- Receipt attachment alone never settles; settle recognizes no payment evidence beyond the recorded receipt reference.
- Settlement without receipt is not approved in V1. Relaxing this rule requires a new product decision.

### Correction, reopen, detach

- V1 has **no** `SETTLED → OPEN` reopen, no due-date or receipt edits after `SETTLED`, and no settlement deletion/detach from the Order.
- Operational consequence: an erroneous settle has no in-application correction path in V1. Mitigations within this contract: explicit named commands by identified Admins (`createdByAdminId`/`settledByAdminId`), receipt-required evidence, and audit candidates. A future correction task (reopen/void with audit) requires its own explicit approval and must not be invented by SET-02.

### Return interaction

- A later ORD-07 `DELIVERED → RETURNED` transition does **not** settle, reopen, delete, or otherwise mutate settlement state. An `OPEN` settlement on a returned Order remains `OPEN` (overdue continues to derive); a `SETTLED` one remains `SETTLED`.
- Return/refund/credit adjustments that interact with settlement are future policy and must not be inferred. ORD-07 must not import or write Settlement state.

### Amount semantics

- A settlement always represents the **full immutable `Order.total`**. There is no persisted amount on the settlement aggregate; the total is read through Order when needed.
- No partial payments, installments, payment methods, provider transaction ids, balances, or refunds. Any partial-settlement capability requires a new decision and schema work.

### Persistence direction (SET-02)

Conceptual shape; SET-02 owns the reviewed migration:

```text
OrderSettlement
  id                        uuid PK
  orderId                   uuid UNIQUE NOT NULL, FK → Order ON DELETE RESTRICT
  status                    OPEN | SETTLED
  dueAt                     timestamptz NOT NULL
  settledAt                 timestamptz NULL
  settledByAdminId          uuid NULL, FK → Admin ON DELETE RESTRICT
  receiptMediaId            uuid NULL, FK → Media ON DELETE RESTRICT
  receiptAttachedAt         timestamptz NULL
  receiptAttachedByAdminId  uuid NULL, FK → Admin ON DELETE RESTRICT
  createdByAdminId          uuid NOT NULL, FK → Admin ON DELETE RESTRICT
  createdAt / updatedAt     timestamptz
```

Invariants:

- `status = SETTLED` ⇔ `settledAt`, `settledByAdminId`, and `receiptMediaId` all NOT NULL.
- `status = OPEN` ⇒ `settledAt` / `settledByAdminId` NULL.
- The receipt triple is all-set or all-null.
- No amount columns, no JSON, no provider/card/bank/accounting fields.
- Index direction `(status, dueAt)` for the operational list and derived overdue; SET-02 confirms with query analysis.

### Authorization

- SET-02 extends the permission catalog with `SETTLEMENT_READ` (list/detail) and `SETTLEMENT_MANAGE` (create, change due date, attach/replace receipt, settle). No role branching; both guards plus permission metadata on every settlement Admin route.
- V1 grants: **`SUPER_ADMIN` only**, by explicit enumeration in the central role policy (no bypass). `WAREHOUSE`/`ORDER_OPS` grants have no legacy capability evidence until MIG-01 and are not granted; widening is a reviewed policy change and remains an explicit unresolved decision.
- No customer settlement APIs exist in V1.

### Admin list contract direction (SET-02)

- Standard CAT-01 pagination envelope and strict query validation (`forbidNonWhitelisted`).
- Filters: `status` (`OPEN` | `SETTLED`), `overdue` (boolean, derived), `dueFrom`/`dueTo` (inclusive ISO instants; boundary semantics owned by the resource per the date-range convention), and exact `orderId`. No `search` parameter in V1 (no evidenced searchable field).
- Sort allowlist: `dueAt`, `createdAt`, `settledAt`; default `dueAt asc` with deterministic `id` tie-break, supporting operational urgency.
- No reporting/analytics endpoints.

### Concurrency and idempotency

- `UNIQUE(orderId)` prevents duplicate aggregates; a racing second create returns `SETTLEMENT_ALREADY_EXISTS`.
- Every mutation is a conditional PostgreSQL write guarded on expected state (settle additionally on receipt presence); application read-check-write alone is insufficient.
- Idempotent replays: attaching the already-attached Media and settling an already `SETTLED` settlement succeed without rewriting timestamps or provenance.
- Redis and BullMQ are never correctness authorities; no Redis locks and no scheduled state transitions.

### Error taxonomy

| Code                             | Meaning                                       | Status |
| -------------------------------- | --------------------------------------------- | -----: |
| `SETTLEMENT_NOT_FOUND`           | Unknown settlement id                         |    404 |
| `SETTLEMENT_ALREADY_EXISTS`      | Order already has a settlement                |    409 |
| `SETTLEMENT_ORDER_NOT_DELIVERED` | Order exists but is not currently `DELIVERED` |    409 |
| `SETTLEMENT_INVALID_DUE_DATE`    | Malformed due-date instant                    |    400 |
| `SETTLEMENT_RECEIPT_REQUIRED`    | Settle attempted without an attached receipt  |    409 |
| `SETTLEMENT_INVALID_TRANSITION`  | Mutation attempted on a `SETTLED` settlement  |    409 |

Reuse `ORDER_NOT_FOUND` (404) when the target Order does not exist at creation, and `MEDIA_NOT_FOUND` (404) when the receipt Media id does not exist. Messages are Admin-displayable and sanitized; errors follow the structured envelope and never carry customer or payment-sensitive detail.

### Media reference and deletion

- `receiptMediaId` uses `ON DELETE RESTRICT`: referenced receipt Media cannot be deleted while attached.
- Because Media deletion currently removes the storage object before the row, SET-02 must check settlement references **before** storage deletion and return the referenced-media conflict contract, so a RESTRICT violation cannot orphan a referenced receipt's bytes. Neither object nor row is removed while referenced.
- Settlement persists only the Media id; URLs remain derived through Media infrastructure.

### Audit, notifications, analytics

- Audit candidates for AUD-01/AUD-02 (not implemented by SET-01/SET-02): `settlement.created` (with `dueAt`), `settlement.due_date_changed` (old/new), `settlement.receipt_attached`, `settlement.receipt_replaced`, `settlement.settled`. Payloads carry ids and safe field deltas only — never file bytes, raw filenames, or payment data. No reopen event exists because reopen is not approved.
- No notifications or reminders in V1. Any due/overdue reminder requires a separately approved notification task and durable outbox delivery; overdue remains read-time derivation.
- Analytics may later derive open/overdue/settled counts and amounts from Order totals. `SETTLED` is never revenue recognition and implies no accounting posting.

## Consequences

- SET-02 implements the schema/migration (human migration review), application commands, permissioned Admin detail/list APIs, OpenAPI, audit hooks, concurrency/idempotency, and real PostgreSQL coverage under this contract.
- SET-02 does not revisit locked lifecycle rules; changing them requires a new product decision.
- Explicitly deferred, each requiring its own approved task: `WAREHOUSE`/`ORDER_OPS` settlement permission grants (MIG-01 evidence); settlement without receipt; reopen/correction/void workflow; return/refund/credit interaction with settlement; multiple receipts or PDF proof; customer-facing settlement surface; due/overdue reminders.

## Related ADRs

- [0011 — Media object storage and multi-upload](0011-media-object-storage-and-multi-upload.md) — receipt storage, allowlist, and deletion rules Settlement builds on.
- [0013 — Order historical snapshots](0013-order-historical-snapshots.md) — immutable `Order.total` that settlement derives its amount from.
- [0014 — Order state machine and transition authorization](0014-order-state-machine-and-transition-authorization.md) — `DELIVERED`/`RETURNED` semantics and the no-payment-state rule.
