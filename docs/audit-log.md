# AUD-01 AuditLog implementation contract

AUD-01 adds an immutable fact record and one validated application append boundary. The Prisma model uses UUID `id`, UTC `occurredAt` at millisecond precision (`TIMESTAMPTZ(3)`), scalar historical actor/entity IDs, nullable diagnostic `requestId`/`correlationId`, and nullable PostgreSQL `JSONB` metadata. It has no lifecycle timestamps and no actor/entity foreign keys or cascades.

The canonical registries are exported from `src/modules/audit/domain/audit-event.ts`. The action registry covers Admin identity/role/permission/disable/password/security events; Product, Category, Region, price, Discount, Inventory, Order, Settlement, commerce policy, Visitor, Blog, and Media events approved by ADR 0023. Entity types are `ADMIN`, `USER`, `PRODUCT`, `CATEGORY`, `REGION`, `DISCOUNT`, `INVENTORY`, `ORDER`, `SETTLEMENT`, `COMMERCE_POLICY`, `VISITOR`, `BLOG`, and `MEDIA`.

Discount lifecycle uses `discount.deactivated` (not `discount.deleted`) because the domain supports deactivation only. Admin login failures use only `invalid_credentials`, `account_disabled`, or `rate_limited`; attempted identifiers and Redis availability are never durable metadata. Successful login and reuse-detection metadata contain only a validated session ID. Other metadata is limited to approved price scalars or changed-field names.

## Entity identity modes

Every action in `AUDIT_ACTION_SPECS` declares whether `entityId` is:

- **required** — a valid UUID must be supplied (most entity-targeted events)
- **nullable** — `null` or a valid UUID (events that may target a singleton or a UUID-backed row)
- **absent** — must be exactly `null` (events with no durable entity target)

Runtime validation rejects malformed UUIDs and mismatched presence rules before persistence.

### Commerce policy (AUD-02 guidance)

`commerce_policy.updated` uses `entityType = COMMERCE_POLICY` with **nullable** `entityId`:

- `entityId = null` for singleton `CommerceSettings` mutations (integer primary key; do not fabricate a UUID)
- `entityId = <uuid>` when the audited operation legitimately targets a UUID-backed override or related row

## Metadata and provenance

Metadata limits are 2,048 UTF-8 bytes, depth 3, 12 keys per object, 256 characters per string/key, and 10 items per array. `changedFields` entries must match a conservative identifier/dotted-field pattern (for example `name`, `isActive`, `orderingOpensAtLocalMinute`); arbitrary prose, email-like strings, URLs, and similar content are rejected.

`normalizeAuditEvent()` validates the caller event only and always leaves `requestId`/`correlationId` null. `AuditLogService.append()` derives request/correlation linkage exclusively from `RequestContextService`; callers cannot provide or spoof those values through the public append API.

It accepts an opaque caller-owned `TransactionContext`, and `AuditLogRepository` performs only one INSERT through that connection. It does not read or lock actor/entity tables and exposes no update/delete/upsert methods. AUD-02 integrated all approved mutation and security paths that exist in production; registry actions whose underlying feature does not yet exist remain deferred. AUD-03 delivered the permissioned Admin AuditLog list/detail read surface; retention and lifecycle deletion remain DATA-01/DATA-03, and this contract makes no WORM or tamper-proof claim.

## AUD-02 Media deletion integration

`MediaService.deleteAdmin()` locks the Media row, checks all durable consumers,
deletes the object using the existing MED-01 sequence, deletes the Media row,
and appends `media.deleted` on the same PostgreSQL transaction connection.
The event uses `actorType = ADMIN`, the authenticated Admin UUID as `actorId`,
`entityType = MEDIA`, the deleted Media UUID as `entityId`, and null metadata.
It is emitted only when the Media row deletion succeeds; referenced, missing,
or failed-delete attempts do not emit it.

Because object storage is external to PostgreSQL, the event proves only the
durable PostgreSQL Media deletion transition. If the object delete succeeds
but the PostgreSQL transaction (including AuditLog insertion) rolls back, the
Media row remains while the object may be missing and requires reconciliation.

## AUD-03 Admin read surface

AuditLog has a read-only Admin HTTP surface:

- `GET /api/v1/admin/audit-logs`
- `GET /api/v1/admin/audit-logs/:id`

Both routes require the explicit `AUDIT_READ` permission. They use pagination,
stable `occurredAt`/`id` ordering, and explicit filters for indexed action,
actor, entity, request/correlation, and occurred-at fields. Unknown query
parameters and unsupported sort/filter values are rejected. There is no free
text or arbitrary metadata search, and no export endpoint.

Responses are explicit safe DTOs. List items omit metadata; detail returns only
the bounded action-specific metadata permitted by this contract. Reads do not
append durable AuditLog events recursively. AUD-03 does not change retention,
deletion, or append/write semantics.
