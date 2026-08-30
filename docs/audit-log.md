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

It accepts an opaque caller-owned `TransactionContext`, and `AuditLogRepository` performs only one INSERT through that connection. It does not read or lock actor/entity tables and exposes no update/delete/upsert methods. PostgreSQL privilege hardening, retention, lifecycle deletion, read APIs, and domain integration remain deferred to the approved future tasks.
