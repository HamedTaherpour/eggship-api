# ADR 0023: AuditLog safe event contract

## Status

Accepted

Human security/privacy architecture gate for AUD-01 is complete. Decisions 1–8 are authoritative for implementation. Deferred DATA lifecycle questions and implementation checkpoints documented below are non-blocking for AUD-01 READY; they must not be treated as open gate blockers.

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

- `InventoryLedger` â†’ inventory movement truth
- `PriceHistory` â†’ price-history truth
- `Order` â†’ transaction/status/snapshot truth
- `DiscountUsageRecord` â†’ discount entitlement truth
- `ReferralAttribution` â†’ attribution truth
- `OrderSettlement` â†’ settlement truth

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

Actor semantics follow Decision 6 (ADMIN, USER, SYSTEM, ANONYMOUS).

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

For `admin.auth.login.succeeded`, durable Admin session creation and required AuditLog insertion **must** commit in the same PostgreSQL transaction.

This is mandatory, not optional "where possible."

A successful durable Admin session must not exist without its required audit evidence.

Token/cookie emission must not represent login success before that transaction commits.

There is no Human-approved exception to this rule.

For security failure events where no business mutation exists, an AuditLog persistence failure obviously has no business mutation to roll back. Application/security logging remains the operational fallback.

#### External side effects

PostgreSQL cannot provide a distributed transaction with external systems such as object storage.

For Media/external-side-effect operations:

- do not pretend AuditLog creates distributed transactional guarantees
- authoritative audit semantics should correspond to the approved durable database transition
- external-side-effect failures/recovery/reconciliation belong to explicit operational handling and `ApplicationLogger` evidence
- AUD-02 must test/document the exact Media sequencing semantics

`media.deleted` is evidence of the approved durable PostgreSQL/database transition.

It must **not** claim that AuditLog itself proves atomic object-storage deletion.

Object-storage deletion, compensation, reconciliation, and operational failures remain governed by Media operational behavior and `ApplicationLogger`.

### 4. Append-only enforcement

AuditLog is append-only through normal application/runtime paths.

Approved V1 rules:

#### Application/repository boundary

The normal AuditLog repository/service contract may expose:

- create/append
- read/query methods required later by AUD-03

It must NOT expose normal:

- update
- delete
- deleteMany
- upsert
- mutation APIs that rewrite existing audit rows

Future retention/archive/deletion mechanisms, if approved by DATA-01/DATA-03, must use a separately governed lifecycle path rather than ordinary AuditLog repository APIs.

#### Schema semantics

AuditLog should:

- have an immutable event timestamp (`occurredAt` / approved equivalent)
- not have `updatedAt`
- not have `deletedAt`
- not depend on cascading ownership FKs that can erase audit history

Actor/entity identities should remain historical scalar identifiers rather than normal cascading foreign-key ownership.

Deactivation/deletion of a referenced business actor/entity must not automatically erase AuditLog evidence.

#### PostgreSQL runtime privileges

Restricting the production runtime DB role to:

- INSERT
- SELECT

while denying:

- UPDATE
- DELETE

on AuditLog is considered desirable hardening.

However, this is NOT an AUD-01 correctness requirement in V1 because current Prisma/Liara deployment and runtime credential separation may not yet support it cleanly.

Record it as production/database-role hardening for later deployment/security work.

Do not force redesign of database credentials inside AUD-01 solely for this.

#### Database triggers

Do NOT require a trigger that universally rejects UPDATE/DELETE in V1.

Reason:
future Human-approved retention/archive/deletion policy may legitimately require lifecycle operations, and those should be governed separately.

#### Tamper-resistance boundary

V1 AuditLog is NOT claimed to be:

- WORM storage
- cryptographically signed
- hash chained
- cryptographically tamper-evident
- resistant to a fully privileged database administrator

Append-only means normal application/runtime workflows cannot rewrite/delete audit history.

It does not imply forensic immutability against infrastructure/DB compromise.

Any stronger tamper-evidence requirement needs a separate future security/operations decision.

#### Retention boundary

AUD-01 does not define retention periods.

If DATA-01/DATA-03 later approves archival/deletion/legal-hold behavior, that lifecycle must be implemented through a separately authorized mechanism.

Do not add normal Admin audit deletion APIs.

### 5. AuditLog read authorization

**APPROVED Human decision.**

V1 policy:

- AuditLog access requires the dedicated `AUDIT_READ` permission.
- Authorization must use the normal permission/RBAC system, not hard-coded role-name checks.
- No Admin role receives access merely because of its role name.
- `SUPER_ADMIN` must still resolve access through the normal permission mapping.
- Customers have no AuditLog API access.
- Permissions for other entities do not imply AuditLog access:
  - `ORDER_READ` != `AUDIT_READ`
  - `MEDIA_READ` != `AUDIT_READ`
  - `ADMIN_MANAGE` != `AUDIT_READ`
- AuditLog is an independently protected security/operations dataset.

[AUD-03](../ROADMAP.md#aud-03--admin-audit-access) read APIs must be read-only and expose explicit response DTOs.

Allowed capabilities may include:

- paginated list
- detail
- explicitly allowlisted filters

Do not expose:

- update/delete
- arbitrary JSON/JSONB querying
- arbitrary metadata search
- raw Prisma/database row serialization

The read contract must preserve the data-minimization guarantees established by AUD-01.

Ordinary AuditLog list/detail reads must NOT themselves create durable AuditLog rows, to avoid recursive/noisy auditing.

Such reads may use normal diagnostic/security logging where operationally useful.

Future sensitive capabilities such as:

- export
- bulk export
- large-scale inspection/download

are NOT implicitly approved by AUD-01/AUD-03.

If introduced later, they require an explicit security/product decision and should be considered candidates for durable audit events themselves.

### 6. Actor semantics and IP/User-Agent policy

**APPROVED Human decision.**

#### Actor model

V1 AuditLog actor types are:

- ADMIN
- USER
- SYSTEM
- ANONYMOUS

Actor identity semantics:

- ADMIN â†’ actorId = authenticated Admin.id
- USER â†’ actorId = authenticated User.id
- SYSTEM â†’ actorId = null
- ANONYMOUS â†’ actorId = null

`actorId` is a historical scalar identifier and must not create cascading ownership semantics.

#### SYSTEM semantics

SYSTEM means the action was genuinely initiated by the system.

Examples may include:

- scheduled system work
- background maintenance
- autonomous worker/job operations
- future system automation

SYSTEM MUST NOT be used as a fallback when an expected Admin/User actor is missing.

If an audit event contract requires an authenticated actor but actor identity is unexpectedly unavailable, treat that as an invariant/programming failure rather than silently recording SYSTEM or ANONYMOUS.

An asynchronous execution context does not automatically make an event SYSTEM.

If an Admin/User initiated a workflow whose later asynchronous step still requires original actor provenance, that provenance must be explicitly propagated according to that workflow's approved contract.

#### ANONYMOUS semantics

ANONYMOUS means the event genuinely occurred without an authenticated principal.

A failed Admin login is an example where ANONYMOUS may be appropriate.

ANONYMOUS MUST NOT be used as a fallback for lost authenticated actor context.

#### IP address and User-Agent

Do NOT persist IP address or User-Agent in the durable V1 AuditLog contract.

They may remain available through appropriately redacted operational/security logging according to existing logging/privacy policy.

Reasons include:

- data minimization
- privacy implications
- cardinality/storage cost
- User-Agent being large/untrusted input
- neither being required for the core durable business audit contract

Durable IP/User-Agent collection may only be introduced later through an explicit security/privacy decision with defined purpose and lifecycle requirements.

#### Provenance invariant

The audit event's actor semantics must reflect who actually initiated the auditable action.

Do not manufacture provenance merely to satisfy schema requirements.

### 7. AuditLog V1 schema shape and stable vocabulary

**APPROVED Human decision.**

AuditLog V1 is a small immutable fact record.

Conceptual persistence shape:

- id
- occurredAt
- actorType
- actorId nullable
- action
- entityType
- entityId nullable
- requestId nullable
- correlationId nullable
- metadata nullable

Exact Prisma/PostgreSQL types remain implementation/migration-review details.

#### Outcome

Do NOT add a generic `outcome` field in V1.

Audit actions should describe facts that occurred, for example:

- `order.cancelled`
- `settlement.settled`
- `admin.auth.login.succeeded`
- `admin.auth.login.failed`

The existence of the event represents the audited fact.

Do not model this as a generic command plus SUCCESS/FAILURE outcome unless a future requirement explicitly justifies it.

#### Action vocabulary

`action` is persisted as a string rather than a PostgreSQL enum.

However, application callers MUST NOT be able to provide arbitrary action strings.

Maintain a canonical closed TypeScript action vocabulary/registry.

Use stable lowercase dotted event names.

Examples include:

- `admin.identity.created` (canonical; reconcile against existing repository terminology — not illustrative `admin.created`)
- `admin.disabled`
- `admin.auth.login.succeeded`
- `admin.auth.login.failed`
- `product.created`
- `product.updated`
- `price.changed`
- `inventory.received`
- `inventory.adjusted`
- `inventory.written_off`
- `order.created`
- `order.cancelled`
- `order.confirmed`
- `order.shipped`
- `settlement.updated`
- `settlement.settled`
- `commerce_policy.updated`
- `blog.published`
- `blog.unpublished`
- `media.deleted`

These examples illustrate naming semantics; they are **not** automatically canonical when the repository already has a more specific stable term.

Before AUD-01 implementation is considered complete, the implementation must publish an **exhaustive canonical action registry** covering every approved Decision 1 event category.

Resolve aliases against existing repository terminology (for example `admin.identity.created` rather than illustrative `admin.created`).

Likewise require an **exhaustive entity-type registry** finalized against actual repository domain models.

Adding a new audit action should normally be an application-contract change, not require a PostgreSQL enum migration.

#### Entity vocabulary

`entityType` is also persisted without requiring a PostgreSQL enum, while remaining a closed application-level TypeScript vocabulary.

Expected concepts include:

- ADMIN
- USER
- PRODUCT
- CATEGORY
- REGION
- DISCOUNT
- INVENTORY
- ORDER
- SETTLEMENT
- COMMERCE_POLICY
- VISITOR
- BLOG
- MEDIA

The implementation must finalize the vocabulary against actual repository domain models.

Arbitrary caller-provided entity types are forbidden.

#### Entity identity

`entityId` may be nullable in persistence because some legitimate audit events do not resolve to a durable entity.

Example:

`admin.auth.login.failed`

may have:

- actorType = ANONYMOUS
- actorId = null
- entityType = ADMIN
- entityId = null

Storage nullability does NOT mean every event contract may omit entityId.

Every action-specific runtime contract must explicitly define whether `entityId` is:

- required
- allowed nullable
- absent/null

Do not infer this generically at runtime.

Action-specific TypeScript contracts must require entityId whenever that event semantically targets an identified entity.

Validate scalar identifier syntax without loading or locking the referenced domain table.

#### Request and correlation linkage

`requestId` and `correlationId` are nullable infrastructure provenance.

Application/domain callers must not manually provide or spoof these fields.

Audit infrastructure should derive them from the existing RequestContext where available.

HTTP operations should preserve available request/correlation linkage.

Background/system operations may legitimately have one or both absent.

If an asynchronous workflow intentionally preserves correlation context, use that propagated infrastructure context.

These identifiers are diagnostic/tracing linkage, not actor identity.

They are **not**:

- authentication evidence
- authorization evidence
- actor provenance proof
- uniqueness/security identifiers

They may be client-influenced through the existing bounded RequestContext behavior.

A forged or reused request/correlation ID must never alter actor identity, entity ownership, or authorization.

Implementation tests must include this trust-boundary checkpoint.

#### Metadata

Persistence may use nullable JSON/JSONB metadata.

This does NOT authorize a generic application API such as:

```typescript
metadata: Record<string, unknown>;
```

Audit events must use action-specific typed/discriminated contracts.

Each action determines:

- allowed metadata fields
- required metadata fields
- whether metadata exists at all
- entity identity requirements

Callers must not be able to attach arbitrary objects.

Prefer bounded values such as:

- status transitions
- changed-field names
- immutable record IDs/references
- revision identifiers
- approved reason codes
- small approved scalar deltas

Do not duplicate authoritative business records into AuditLog.

The forbidden-data/data-minimization rules from Decision 2 remain fully applicable.

#### Metadata bounds

Approve the invariant that metadata must be:

- small
- bounded
- action-specific
- shallow/structurally constrained
- unsuitable as a generic JSON document store

Exact size/depth limits are not defined in this ADR.

Exact technical limits must be proposed during implementation design, reviewed, and covered by tests before AUD-01 is complete.

#### Indexing

Index design is an implementation/migration-review concern rather than a new Human product policy.

The implementation should evaluate expected AUD-03 access patterns, including:

- chronological access
- actor history
- entity history
- action filtering

Do not add indexes blindly.

Migration review should verify the final indexes against the approved query model and write cost.

#### Explicit V1 exclusions

V1 does NOT introduce:

- generic outcome
- generic before/after
- arbitrary actions
- arbitrary entity types
- arbitrary metadata
- PostgreSQL enums merely to encode evolving action/entity vocabularies
- raw entity/DTO/request serialization into metadata

### 8. Bootstrap Admin provenance

**APPROVED Human decision.**

Trusted bootstrap Admin creation through the repository's administrative CLI is explicitly classified as a genuine SYSTEM-initiated operation.

For bootstrap CLI Admin creation:

- actorType = SYSTEM
- actorId = null
- entityType = ADMIN
- entityId = newly created Admin ID

This is **not** a fallback for missing actor context.

It is valid because the trusted bootstrap CLI operation is genuinely initiated outside an authenticated Admin application session.

If a future authenticated Admin-management workflow allows one Admin to create another Admin:

- actorType = ADMIN
- actorId = initiating Admin ID

That workflow **must not** silently classify the action as SYSTEM.

V1 must **not** invent untrusted operator-provenance fields such as:

- operatorName
- shell username
- machine name
- arbitrary operator email
- deployment username

If durable human operator identity for CLI/deployment operations becomes necessary later, it requires a separately designed trusted operator identity/provenance model.

Use the repository's existing naming contracts when finalizing the action registry.

In particular, reconcile Admin identity creation vocabulary with the existing `admin.identity.created` naming rather than assuming illustrative `admin.created` examples are canonical.

## Implementation constraints

The following are implementation constraints consistent with approved Decisions 1–8.

They do **not** require new Human policy decisions.

### Single validated writer boundary

Require one canonical AuditLog append/writer boundary.

Application callers must use exhaustive action-specific typed/discriminated event contracts.

The writer boundary must also perform runtime validation.

TypeScript compile-time types alone are insufficient.

The runtime boundary must reject:

- unknown actions
- unknown entity types
- unknown metadata keys
- invalid entityId presence/absence
- forbidden metadata values/shapes
- metadata exceeding approved implementation bounds

The persistence repository must receive only normalized/validated audit records.

It must not expose a generic JSON escape hatch.

### Authentication failure vocabulary

The final action registry must explicitly define the durable Admin login failure contract and bounded reason codes.

Do not store attempted email/identifier or other PII in AuditLog metadata.

The implementation review must explicitly reconcile existing login rejection cases such as:

- invalid credentials
- disabled account
- malformed/rejected credentials where applicable
- rate limiting where applicable

Do not silently broaden the durable AuditLog boundary beyond Decision 1.

If final implementation discovers that inclusion/exclusion of a failure class materially changes the Human-approved security-event boundary, stop and request Human review.

### Lock-order invariant

AuditLog insertion must **not** query or lock actor/entity domain tables merely to validate historical scalar identifiers.

Audit writer validation should validate contract/scalar syntax only.

Do not acquire Admin/User/Product/Order/Media/etc. row locks from generic AuditLog infrastructure.

Audit insertion should introduce only the database work necessary to insert/index the AuditLog record.

Existing domain/application services remain responsible for validating the business entity within their existing transaction/lock order.

This invariant must be included in concurrency/deadlock review.

## Deferred items and implementation checkpoints

The following are **not** blocking the approved AuditLog architecture.

They must not be incorrectly presented as gate blockers.

### Legal hold

Explicitly deferred to [DATA-01](../ROADMAP.md#data-01--data-classification-and-retention-decision-register) / [DATA-03](../ROADMAP.md#data-03--durable-business-records-and-backup-lifecycle) as applicable.

**Not** an AUD-01 implementation blocker.

No policy is invented here.

### Retention/deletion

Explicitly deferred to [DATA-01](../ROADMAP.md#data-01--data-classification-and-retention-decision-register) / [DATA-03](../ROADMAP.md#data-03--durable-business-records-and-backup-lifecycle).

**Not** an AUD-01 implementation blocker.

No duration is invented here.

### Exact metadata limits

Remains an AUD-01 implementation review checkpoint.

This is **not** a Human business/privacy decision.

Implementation must propose explicit bounded limits and tests before AUD-01 can be marked DONE.

### Implementation/migration-review checkpoints (AUD-01 completion)

- Exhaustive canonical action registry covering every approved Decision 1 event category, with aliases resolved against existing repository terminology.
- Exhaustive entity-type registry finalized against actual repository domain models.
- Exact Prisma/PostgreSQL column types and index design for the approved conceptual schema shape.
- Bounded Admin login failure reason codes reconciled against existing rejection cases.
- Concurrency/deadlock review including the lock-order invariant.
- Request/correlation trust-boundary test checkpoints.
- Media deletion sequencing documented and tested in AUD-02.

## Consequences

- AUD-01 implementation must conform to the approved boundaries above; deferred items and implementation checkpoints do not block the approved architecture.
- AUD-01 must implement the approved Decision 7 conceptual schema shape with closed TypeScript action/entity vocabularies; arbitrary caller-provided actions, entity types, or metadata remain forbidden.
- AUD-01 must provide one canonical validated AuditLog writer boundary with runtime contract enforcement; the persistence repository must not expose a generic JSON escape hatch.
- AUD-02 domain integration must use the centrally approved action vocabulary and typed contracts; modules must not write AuditLog tables directly across module boundaries.
- Successful Admin login must commit session creation and `admin.auth.login.succeeded` audit evidence in the same PostgreSQL transaction before tokens/cookies represent success.
- Application/security logging ([observability policy](../../instructions/observability.md)) remains the operational channel for high-volume security noise and for audit persistence failures where no business mutation exists to roll back.
- Retention, deletion, and legal-hold policy wait on DATA-01/DATA-03; do not guess durations, deletion rules, or hold requirements in AUD-01.
- AUD-01 must enforce append-only semantics through the application/repository boundary and approved schema shape; PostgreSQL runtime privilege hardening and any lifecycle deletion path are out of scope for AUD-01 correctness unless separately approved.
- Exact metadata size/depth limits and index design are implementation/migration-review deliverables, not Human product-policy decisions.
- Bootstrap CLI Admin creation uses SYSTEM actor semantics per Decision 8; future authenticated Admin-management workflows must not silently downgrade to SYSTEM.
