# ADR 0023: AuditLog safe event contract

## Status

**DRAFT — HUMAN SECURITY/PRIVACY GATE IN PROGRESS**

This document is a working decision record for the AUD-01 Human + ChatGPT security/privacy architecture gate. Approved Human decisions recorded here are authoritative for architectural meaning during the gate. Further Human + ChatGPT decisions will be appended to this same draft before AUD-01 implementation begins. When the gate completes, this ADR may be accepted and downstream instruction updates may follow in AUD-01/AUD-02 implementation tasks.

This ADR does not implement AuditLog, change Prisma, add migrations, or modify application code.

## Context

[AUD-01](../ROADMAP.md#aud-01--auditlog-model-and-safe-event-contract) requires a durable, append-oriented AuditLog with actor, action, entity identity, safe metadata, request/correlation provenance, and timestamps. Sensitive fields must be excluded or redacted by construction. AuditLog is distinct from application/security logging ([observability policy](../../instructions/observability.md)) and from domain business-history stores.

Retention, deletion, backup, and legal-hold policy for AuditLog are owned by [DATA-01](../ROADMAP.md#data-01--data-classification-and-retention-decision-register) and must not be invented here.

Related policy:

- [Security](../../instructions/security.md) — validation, secrets, logging boundaries
- [Observability](../../instructions/observability.md) — structured logging, redaction, request/correlation IDs
- [Authorization](../../instructions/authorization.md) — authorization denials vs business audit trail
- [Authentication](../../instructions/authentication.md) — Admin identity security-sensitive events
- Domain modules already name AUD-01 audit candidates (catalog, inventory, orders, settlement, commerce-policy, content, media)

## Decision

### 1. Audit event boundary

#### Admin mutations

Durably audit meaningful Admin mutations, including:

- Admin identity creation
- Admin role/permission changes
- Admin disablement
- Admin password change/reset when implemented
- Product/Category/Region mutations
- Product price changes
- Discount mutations
- Inventory receive/adjust/write-off/correction operations
- Admin Order transitions
- Settlement mutations
- Commerce-policy mutations
- Visitor mutations when management exists
- Blog publish/unpublish
- Media deletion

Do not audit ordinary Admin reads.

Not every low-value technical mutation must automatically become an audit event; AUD-02 integrations must follow the centrally approved action vocabulary.

Media upload is **not** currently required as a durable AuditLog event. This may be revisited if future security/product requirements justify it.

#### Customer mutations

Durably audit selected important customer business mutations:

- `order.created`
- `order.cancelled`

Do not audit:

- product views
- ordinary reads
- notification read/unread
- local Cart operations
- ordinary navigation

#### Security events

Durable AuditLog candidates approved for V1:

- successful Admin login
- failed Admin login
- refresh-token reuse detection
- Admin password change/reset
- revoke-all Admin sessions
- Admin account disablement

Keep ordinary events such as:

- customer OTP failures
- CSRF failures
- validation failures
- ordinary 401/403 responses
- application exceptions

in security/application logging rather than durable AuditLog unless a later explicit security decision changes the boundary.

AuditLog must not become HTTP/request logging.

#### Relationship to existing business records

Existing business records remain authoritative for their detailed business history.

Examples:

- `InventoryLedger` → inventory movement truth
- `PriceHistory` → price-history truth
- `Order` → transaction/status/snapshot truth
- `DiscountUsageRecord` → discount entitlement truth
- `ReferralAttribution` → attribution truth
- `OrderSettlement` → settlement truth

AuditLog adds actor/action/entity/request/security provenance and must not duplicate those records wholesale.

### 2. Audit payload and data minimization

V1 **must not** expose generic `before` / `after` object capture.

V1 **must not** expose a generic application-layer:

```typescript
metadata: Record<string, unknown>;
```

audit API.

Use action-specific typed audit contracts.

Persistence may use JSON/JSONB internally, but application callers must only be able to provide metadata explicitly allowed for that action.

Prefer small deltas, references, IDs, status transitions, changed-field names, revision numbers, reason codes, or other explicitly approved bounded scalar metadata.

Do not serialize:

- Prisma entities
- DTOs wholesale
- request bodies
- response bodies

Existing business records remain the source of truth for detailed historical data.

#### Forbidden audit payload data by default

Audit event contracts must not permit:

- passwords/password hashes
- access tokens
- refresh tokens
- refresh-token hashes/digests
- OTP values
- verification grants
- CSRF tokens
- cookies
- Authorization headers
- secrets/provider credentials
- arbitrary request/response bodies
- exception stack traces
- uploaded bytes/base64
- Blog Markdown/body
- Notification body/payload
- Media `storageKey`
- receipt URLs/object-storage internals

PII is absent by default, including:

- customer phone
- email
- address
- profile fields
- Admin contact/name snapshots

Actor identity is represented by:

- `actorType`
- immutable scalar `actorId` when applicable

Do not store Admin role/permission snapshots in V1.

SYSTEM/anonymous actor semantics remain part of the AUD-01 contract, but must follow the final approved actor model.

### 3. Transaction and audit failure semantics

For every successful PostgreSQL mutation classified as audit-required:

Business mutation + AuditLog insert **must** commit atomically in the same PostgreSQL transaction.

Policy:

- fail closed
- no best-effort authoritative audit
- no asynchronous authoritative AuditLog
- no `OutboxEvent` as the source of truth for the V1 audit record

If AuditLog persistence fails, the audit-required PostgreSQL business mutation must roll back.

This applies consistently rather than maintaining a complicated per-action fail-open/fail-closed matrix.

#### Authentication cases

For successful authentication flows where session creation and AuditLog persistence can share PostgreSQL transactional semantics, audit-required success should not leave a successful durable session without its required audit evidence.

For security failure events where no business mutation exists, an AuditLog persistence failure obviously has no business mutation to roll back. Application/security logging remains the operational fallback.

#### External side effects

PostgreSQL cannot provide a distributed transaction with external systems such as object storage.

For Media/external-side-effect operations:

- do not pretend AuditLog creates distributed transactional guarantees
- authoritative audit semantics should correspond to the approved durable database transition
- external-side-effect failures/recovery/reconciliation belong to explicit operational handling and `ApplicationLogger` evidence
- AUD-02 must test/document the exact Media sequencing semantics

## Still unresolved

The following decisions are **not yet approved** and must not be implemented or assumed:

1. Append-only enforcement level in PostgreSQL.
2. Exact AuditLog read authorization (see planned [AUD-03](../ROADMAP.md#aud-03--admin-audit-access)).
3. IP/User-Agent durable storage policy.
4. Legal-hold requirements.
5. AuditLog retention/deletion/backup policy — owned by [DATA-01](../ROADMAP.md#data-01--data-classification-and-retention-decision-register) and must **not** be invented here.
6. Exact final AuditLog schema/action/entity vocabularies.
7. Exact metadata size/depth bounds.
8. Any remaining actor/SYSTEM semantics requiring Human approval.

Further Human + ChatGPT gate decisions will be appended to this draft before AUD-01 implementation begins.

## Consequences

- AUD-01 implementation must conform to the approved boundaries above; unresolved items remain blocked until explicitly decided.
- AUD-02 domain integration must use the centrally approved action vocabulary and typed contracts; modules must not write AuditLog tables directly across module boundaries.
- Application/security logging ([observability policy](../../instructions/observability.md)) remains the operational channel for high-volume security noise and for audit persistence failures where no business mutation exists to roll back.
- Retention and lifecycle policy waits on DATA-01; do not guess durations or deletion rules in AUD-01.
