# Deferred settlement tracking

EggShip V1 has no payment gateway. The approved requirement is operational tracking after delivery: an Admin assigns a due date, registers externally received proof through the existing Media library, and tracks open/overdue/settled work. Lifecycle decisions are accepted in [ADR 0018](../docs/adr/0018-deferred-settlement-lifecycle.md) (SET-01) and implemented by SET-02. Deferred items at the bottom must not be invented.

## Approved boundaries

- Every customer Order is eligible; there is no customer enablement or credit flag in V1.
- `dueAt` is assigned by Admin only after the Order reaches `DELIVERED`.
- Receipt/proof originates outside EggShip and is registered by Admin.
- Media owns object bytes and metadata. Settlement stores references only.
- PostgreSQL is authoritative. No provider, card, bank credential, transaction id, balance, refund, or accounting subsystem is introduced.
- Settlement state remains separate from the Order state machine. It does not block delivery or rewrite Order status, and Order transitions never rewrite settlement state.

## Bounded module

`src/modules/settlements` owns a one-to-one settlement aggregate rooted by `orderId` (`UNIQUE`). Do not add settlement columns to `Order`: the separate model owns its lifecycle, queries, permissions, and audit events while Orders keeps delivery state and immutable totals. Settlement reads Order identity/status/total read-only and never writes Order tables.

Persisted shape (`20260827090000_deferred_settlement`):

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

Invariants: `SETTLED` ⇔ `settledAt` / `settledByAdminId` / `receiptMediaId` all NOT NULL; `OPEN` ⇒ `settledAt` NULL; the receipt triple is all-set or all-null. SQL CHECK constraints enforce both lifecycle/provenance shapes. No amount columns (settlement always represents the full immutable `Order.total`, read through Order), no JSON, no payment fields. The operational index starts with `(status, dueAt)`; stable sort indexes cover `dueAt`, `createdAt`, and `settledAt` with `id` tie-breaks.

## Lifecycle

- Statuses: `OPEN` and `SETTLED` only. `OPEN → SETTLED` is the only transition.
- `overdue` is derived at query time as `dueAt < now AND status = OPEN` using a database/server instant. It is not a stored status and no scheduled job produces it.
- Creating the settlement and assigning `dueAt` is one explicit Admin command, allowed only for an Order currently `DELIVERED` (checked in the same transaction, Order verified before the settlement row). Missing Order → `ORDER_NOT_FOUND`; any other status → `SETTLEMENT_ORDER_NOT_DELIVERED`. Delivery never implies payment state.
- Settling is an explicit Admin command that sets `settledAt` and `settledByAdminId`. Exactly one competing settle wins; replay on a settled settlement is idempotent and rewrites nothing.

## Due-date semantics

- `dueAt` is required at creation: an absolute UTC `timestamptz`, ISO 8601 at API boundaries. Jalali/Tehran-local entry is an Admin UX concern; the backend stores and compares absolute instants.
- A past `dueAt` is allowed; there is no "must be in the future" rule.
- `dueAt` is editable only while `OPEN` through an explicit change-due-date command (audit candidate). It is immutable after `SETTLED`.
- Overdue comparison uses server/database now; clients never supply the comparison instant.

## Receipt rules

- Exactly **one current receipt** per settlement: nullable `receiptMediaId` directly on `OrderSettlement`, plus `receiptAttachedAt` / `receiptAttachedByAdminId` provenance. No join table; a future approved multi-receipt rule is an additive migration.
- Attachment is an explicit Admin command allowed only while `OPEN`. Attaching the already-attached Media is an idempotent no-op; attaching different Media replaces the reference atomically. The replaced Media object becomes unreferenced — orphan/retention policy belongs to Media lifecycle (DATA-02), and no retention period is invented here.
- Validate that the referenced Media row exists (`MEDIA_NOT_FOUND`) and is an allowed proof type before attachment. The Media allowlist is image/jpeg, image/png, image/webp; PDF proof is not approved and must not be silently added. Never accept arbitrary/unowned storage keys.
- Attachment never changes settlement status. The receipt triple is set together and is immutable after settlement.
- Settling **requires** a currently attached receipt (`SETTLEMENT_RECEIPT_REQUIRED`). Settlement without receipt is not approved in V1; relaxing this requires a new product decision.

## Correction, reopen, detach

V1 has no `SETTLED → OPEN` reopen, no due-date or receipt edits after settlement, and no settlement deletion/detach. Operational consequence: an erroneous settle has no in-application correction path in V1; mitigations are explicit named commands by identified Admins, receipt-required evidence, and audit candidates. A correction task (reopen/void with audit) requires its own explicit approval.

## Return interaction

A later ORD-07 `DELIVERED → RETURNED` transition does not settle, reopen, delete, or otherwise mutate settlement state: an `OPEN` settlement remains `OPEN` (overdue still derives) and a `SETTLED` one remains `SETTLED`. Return/refund/credit adjustments interacting with settlement are future policy and must not be inferred; ORD-07 must not import or write Settlement state.

## Media rules

- `receiptMediaId` uses `ON DELETE RESTRICT`. Referenced receipt Media cannot be deleted while attached; deletion answers the referenced-media conflict contract.
- Media deletion must check settlement references **before** storage object deletion so a restricted row never loses its object bytes. Neither object nor row is removed while referenced.
- Settlement never stores binary bytes, `storageKey`, or a host-specific URL; URLs remain derived through Media infrastructure.

## Admin list and authorization

The dedicated Admin list follows CAT-01 pagination and strict query validation:

- Filters: `status` (`OPEN` | `SETTLED`), `overdue` (boolean, derived), `dueFrom`/`dueTo` (inclusive ISO instants; boundary semantics owned by Settlement per the date-range convention), and exact `orderId`. No `search` in V1.
- Sort allowlist: `dueAt`, `createdAt`, `settledAt`; default `dueAt asc` with deterministic `id` tie-break. No reporting/analytics endpoints.

Permissions: `SETTLEMENT_READ` (list/detail) and `SETTLEMENT_MANAGE` (create, change due date, attach/replace receipt, settle), added to the catalog by SET-02. V1 grants `SUPER_ADMIN` only, by explicit enumeration; there is no bypass and no role branching. `WAREHOUSE`/`ORDER_OPS` grants have no legacy capability evidence until MIG-01 and remain an explicit unresolved decision. Customer settlement endpoints are not approved.

Admin routes use both guards and permission metadata. Order identity comes from the request, but the service verifies the Order exists and is delivered. Errors are Admin-displayable, sanitized, and must not leak customer or payment-sensitive data.

Implemented Admin routes are `GET/POST /api/v1/admin/settlements`, `GET /api/v1/admin/settlements/:id`, and explicit `POST .../:id/change-due-date`, `POST .../:id/receipt`, and `POST .../:id/settle` commands. Receipt commands accept only an existing Media id; uploads remain owned by Media.

## Concurrency and idempotency

- `UNIQUE(orderId)` prevents duplicate settlement aggregates; a racing second create returns `SETTLEMENT_ALREADY_EXISTS`.
- Assign/correct/attach/settle commands use conditional PostgreSQL writes guarded on expected state; application read-check-write alone is insufficient.
- Creation checks the delivered Order and creates the settlement in one transaction, following the Orders-before-Settlement lock order.
- Idempotent replays: attaching the same Media again and settling an already settled settlement succeed without rewriting timestamps or provenance.
- Redis/BullMQ are not correctness authorities. Future overdue reminders would use durable outbox semantics and must not create a second settlement status.

## Error codes

Small stable set: `SETTLEMENT_NOT_FOUND` (404), `SETTLEMENT_ALREADY_EXISTS` (409), `SETTLEMENT_ORDER_NOT_DELIVERED` (409), `SETTLEMENT_INVALID_DUE_DATE` (400), `SETTLEMENT_RECEIPT_REQUIRED` (409), `SETTLEMENT_INVALID_TRANSITION` (409). Reuse `ORDER_NOT_FOUND` for a missing Order at creation and `MEDIA_NOT_FOUND` for a missing receipt Media id.

## Audit, notifications, and analytics

SET-02 emits structured `settlement.created`, `settlement.due_date_changed`, `settlement.receipt_attached`, `settlement.receipt_replaced`, and `settlement.settled` application events after commit, with ids and safe deltas only. Durable AuditLog persistence remains AUD-01/AUD-02 and is not implemented here. Permission denials continue through the shared authorization log. No event contains file bytes, raw filenames, storage keys, or payment data.

Notifications are not approved merely because a due date exists. Any reminder/escalation type, recipient, cadence, and Tehran scheduling rule requires an explicit notification task and transactional outbox integration; SET-02 introduces no BullMQ scheduling.

Analytics may later count open/overdue/settled records and derive amounts from Order totals. `SETTLED` is not revenue recognition and implies no accounting posting.

## Deferred decisions

Each requires its own approved task and must not be implemented speculatively:

- `WAREHOUSE`/`ORDER_OPS` settlement permission grants (pending MIG-01 legacy capability evidence).
- Settlement without a receipt.
- Reopen/correction/void workflow for erroneous settlements.
- Return/refund/credit adjustments interacting with settlement.
- Multiple receipts per settlement or PDF proof.
- Customer-facing settlement read surfaces.
- Due/overdue reminders.
