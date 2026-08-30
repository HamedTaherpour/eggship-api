# DATA-01: Data classification and retention decision register

## 1. Purpose and scope

This document is the canonical DATA-01 register for EggShip. It records the
current data inventory, sensitivity and lifecycle classifications, approved
lifecycle principles from the completed Human decision process, existing
expiry/deletion mechanisms, explicit invariants, unresolved policy decisions,
and ownership of follow-up work.

DATA-01 is a governance and documentation task. It does not approve retention
durations, implement cleanup, add legal holds, or delete/anonymize data. A
configuration TTL, expiry timestamp, queue setting, or database constraint
described here is current implementation evidence; it is not automatically a
business, legal, accounting, security, or backup-retention decision.

The register covers the current PostgreSQL schema, current Redis/BullMQ state,
application/security logging boundaries, object storage references, and future
recovery copies. Future or not-yet-implemented data is explicitly marked.

## 2. Classification vocabulary

### Sensitivity

- **PUBLIC** — intended for public presentation or public content delivery.
- **INTERNAL** — non-public operational or administrative information.
- **PII** — information identifying or linkable to a customer, operator, or
  acquisition actor.
- **SECURITY_SENSITIVE** — credentials, authentication state, security evidence,
  or material that could enable or diagnose account compromise.
- **FINANCIAL_BUSINESS_SENSITIVE** — orders, pricing, stock, discount, settlement,
  or other commercially meaningful records.
- **OPERATIONAL_SENSITIVE** — infrastructure, delivery, recovery, or diagnostic
  information whose disclosure or loss could affect operations.

Multiple labels are allowed. No actual secrets are recorded in this register.

### Lifecycle

- **EPHEMERAL_SECURITY** — short-lived security workflow state; not durable
  history.
- **ACTIVE_OPERATIONAL_STATE** — mutable state needed for current operation.
- **DURABLE_BUSINESS_RECORD** — historical business evidence or a record whose
  meaning must survive ordinary account/catalog changes.
- **APPEND_ONLY_BUSINESS_HISTORY** — immutable event history explaining business
  state.
- **AUDIT_SECURITY_RECORD** — durable security/operations evidence at the
  approved audit boundary.
- **CONTENT_ASSET** — authored content, reusable metadata, or object bytes.
- **DERIVED_REBUILDABLE_DATA** — state that can be rebuilt from authoritative
  records and is not itself the source of truth.
- **OPERATIONAL_TELEMETRY** — delivery, logging, or diagnostic state.
- **BACKUP_RECOVERY_COPY** — a recovery copy of another system's data.

Some classes intentionally span concepts. For example, a current balance is
active operational state while its ledger is append-only business history;
these are not interchangeable.

## 3. Current data classification inventory

| Data class (current unless marked future)                                                    | Repository evidence / purpose                                                | Sensitivity                                                                    | Lifecycle                              | Authority and lifecycle note                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`                                                                                       | Customer identity (`phone`, active flag)                                     | PII, SECURITY_SENSITIVE                                                        | ACTIVE_OPERATIONAL_STATE               | Identity is deactivated rather than casually deleted; Orders survive account lifecycle.                                                                                                                           |
| `Admin`                                                                                      | Operator identity, role, password digest, active flag                        | PII, SECURITY_SENSITIVE                                                        | ACTIVE_OPERATIONAL_STATE               | Passwords are digest-only; deactivation is preferred and referenced records use restrictive FKs.                                                                                                                  |
| `AuthSession`, `AdminAuthSession`                                                            | Current refresh sessions, expiry, revocation, token-family state             | SECURITY_SENSITIVE                                                             | ACTIVE_OPERATIONAL_STATE               | Active valid rows are protected; expired/revoked rows are not automatically removable without the approved safety window.                                                                                         |
| `AuthRefreshTokenConsumption`, `AdminAuthRefreshTokenConsumption`                            | Consumed refresh digests for reuse detection                                 | SECURITY_SENSITIVE                                                             | EPHEMERAL_SECURITY                     | PostgreSQL-authoritative, bounded by an `expiresAt` field; required reuse-detection window remains policy-unresolved.                                                                                             |
| OTP challenges, verification grants, cooldowns, rate limits in Redis                         | OTP workflow and abuse-control state                                         | SECURITY_SENSITIVE                                                             | EPHEMERAL_SECURITY                     | Redis TTL/atomic scripts expire workflow state; it is not durable history and must not become an analytics store.                                                                                                 |
| `Order`, `OrderLine`, order snapshots                                                        | Fulfillment transaction, immutable customer/product/region/pricing snapshots | PII, FINANCIAL_BUSINESS_SENSITIVE                                              | DURABLE_BUSINESS_RECORD                | Snapshots are authoritative historical evidence; ordinary hard deletion is prohibited. PII lifecycle may differ only through governed future work.                                                                |
| `Inventory`                                                                                  | Current `onHand`/`reserved` balance                                          | FINANCIAL_BUSINESS_SENSITIVE, OPERATIONAL_SENSITIVE                            | ACTIVE_OPERATIONAL_STATE               | Current operational truth; it does not replace the ledger.                                                                                                                                                        |
| `InventoryReservation`                                                                       | Per-order/product reservation, `ACTIVE`/`RELEASED`/`SHIPPED`                 | FINANCIAL_BUSINESS_SENSITIVE                                                   | ACTIVE_OPERATIONAL_STATE               | Active rows are protected; terminal rows may become candidates only after an approved safety window.                                                                                                              |
| `InventoryLedger`                                                                            | Stock movement and after-state evidence                                      | FINANCIAL_BUSINESS_SENSITIVE, OPERATIONAL_SENSITIVE                            | APPEND_ONLY_BUSINESS_HISTORY           | Append-only explanation of inventory state; individual events are not ordinary cleanup targets.                                                                                                                   |
| `InventoryCommandIdempotency`                                                                | Admin command claims and completed results                                   | OPERATIONAL_SENSITIVE, FINANCIAL_BUSINESS_SENSITIVE                            | ACTIVE_OPERATIONAL_STATE               | `PENDING` rows cannot be blindly cleaned; `COMPLETED` cleanup requires an approved safety window.                                                                                                                 |
| `Product.price`                                                                              | Current catalog price                                                        | FINANCIAL_BUSINESS_SENSITIVE                                                   | ACTIVE_OPERATIONAL_STATE               | Current price is not historical evidence.                                                                                                                                                                         |
| `PriceHistory`                                                                               | Catalog price-change events                                                  | FINANCIAL_BUSINESS_SENSITIVE                                                   | APPEND_ONLY_BUSINESS_HISTORY           | Append-only catalog history; ordinary cleanup must not rewrite/delete events.                                                                                                                                     |
| `Discount`                                                                                   | Admin-managed discount definition and active/window state                    | FINANCIAL_BUSINESS_SENSITIVE                                                   | ACTIVE_OPERATIONAL_STATE               | Deactivation is the lifecycle operation; order snapshots independently preserve applied discount evidence.                                                                                                        |
| `DiscountCustomerUsage`                                                                      | Current consumed lifetime quantity per customer/discount                     | PII, FINANCIAL_BUSINESS_SENSITIVE                                              | ACTIVE_OPERATIONAL_STATE               | Current aggregate supports the lifetime limit and is not a substitute for usage history.                                                                                                                          |
| `DiscountUsageRecord`                                                                        | `CONSUME`/`RELEASE` events tied to an opaque order identity                  | PII, FINANCIAL_BUSINESS_SENSITIVE                                              | APPEND_ONLY_BUSINESS_HISTORY           | Append-only historical evidence; ordinary cleanup must not break consistency.                                                                                                                                     |
| `CommerceSettings`, `CommerceScheduleOverride`                                               | Current ordering policy and date-specific override                           | INTERNAL, FINANCIAL_BUSINESS_SENSITIVE                                         | ACTIVE_OPERATIONAL_STATE               | Current policy is authoritative; override removal is an explicit business operation, not retention cleanup.                                                                                                       |
| `OrderSettlement`                                                                            | Deferred settlement state, due date, admin provenance, receipt reference     | PII, FINANCIAL_BUSINESS_SENSITIVE                                              | DURABLE_BUSINESS_RECORD                | Linked to Order and receipt evidence; receipt reference must not be removed while policy requires evidence.                                                                                                       |
| `Notification`                                                                               | Customer-facing inbox history and minimized payload                          | PII, INTERNAL                                                                  | DURABLE_BUSINESS_RECORD                | Durable independently from push delivery, but not authoritative business history; `readAt` alone is not deletion authorization.                                                                                   |
| `OutboxEvent`                                                                                | PostgreSQL-authoritative event intent and dispatch/recovery state            | OPERATIONAL_SENSITIVE, FINANCIAL_BUSINESS_SENSITIVE                            | ACTIVE_OPERATIONAL_STATE               | Non-terminal rows are protected for recovery; successfully published rows may become candidates after an approved recovery window.                                                                                |
| BullMQ job state                                                                             | Queue delivery attempts, retry/failure history                               | OPERATIONAL_SENSITIVE                                                          | OPERATIONAL_TELEMETRY                  | Delivery telemetry only; never business or audit source of truth. Current queue `removeOnComplete`/`removeOnFail` settings are operational tuning, not policy retention.                                          |
| `AuditLog`                                                                                   | Approved ADR 0023 security/operations facts                                  | SECURITY_SENSITIVE, OPERATIONAL_SENSITIVE                                      | AUDIT_SECURITY_RECORD                  | Append-only through normal application paths; lifecycle is independent of application logs and requires a separately governed path.                                                                               |
| Application/security logs                                                                    | Structured request, error, and operational diagnostics                       | SECURITY_SENSITIVE, OPERATIONAL_SENSITIVE, PII                                 | OPERATIONAL_TELEMETRY                  | Must be data-minimized and independent of AuditLog; no passwords, tokens, OTPs, cookies, authorization headers, raw sensitive bodies, or unnecessary PII.                                                         |
| `Visitor`                                                                                    | Acquisition actor identity and non-reusable referral code                    | PII, INTERNAL                                                                  | ACTIVE_OPERATIONAL_STATE               | Deactivation preserves identity and attribution history; visitor Admin/read lifecycle remains separately owned.                                                                                                   |
| `ReferralAttribution`                                                                        | Immutable registration-time Visitor attribution                              | PII, INTERNAL                                                                  | DURABLE_BUSINESS_RECORD                | No update/delete repository API; attribution and code identity are historical evidence.                                                                                                                           |
| Blog/content records (`Blog`, taxonomy, `BlogAuthor`)                                        | Published/draft Markdown source, taxonomy, author and SEO metadata           | PUBLIC, INTERNAL                                                               | CONTENT_ASSET                          | Public eligibility is explicit; drafts and admin-only metadata must not leak. Revisions/scheduling are not current.                                                                                               |
| Media metadata (`Media`, reference registry)                                                 | Reusable object identity, metadata, and durable consumer references          | INTERNAL, OPERATIONAL_SENSITIVE                                                | CONTENT_ASSET                          | Referenced and valid unreferenced library assets are both supported; metadata is not object bytes.                                                                                                                |
| Media objects                                                                                | JPEG/PNG/WebP bytes in object storage                                        | INTERNAL, OPERATIONAL_SENSITIVE                                                | CONTENT_ASSET                          | Storage is outside PostgreSQL; settlement receipt objects follow settlement evidence lifecycle.                                                                                                                   |
| Settlement receipts                                                                          | Media objects referenced by `OrderSettlement`                                | FINANCIAL_BUSINESS_SENSITIVE, OPERATIONAL_SENSITIVE                            | DURABLE_BUSINESS_RECORD, CONTENT_ASSET | Receipt reference and object are linked evidence; generic orphan cleanup must exclude required receipts.                                                                                                          |
| PostgreSQL backups (**future/provider capability; not evidenced in repository**)             | Recovery copies of PostgreSQL records                                        | PII, SECURITY_SENSITIVE, FINANCIAL_BUSINESS_SENSITIVE, BACKUP_RECOVERY_COPY    | BACKUP_RECOVERY_COPY                   | Required recovery surface, but capability/configuration is not implemented here. Separate backup/privacy lifecycle; deletion or anonymization of primary data does not instantly remove historical backup copies. |
| Object Storage recovery copies (**future/provider capability; not evidenced in repository**) | Recovery copies of Media and receipts                                        | PII, FINANCIAL_BUSINESS_SENSITIVE, OPERATIONAL_SENSITIVE, BACKUP_RECOVERY_COPY | BACKUP_RECOVERY_COPY                   | Required recovery surface, but capability/configuration is not implemented here. Independent provider mechanism is allowed, but restore must account for cross-system consistency and Media reconciliation.       |
| Push installations/tokens                                                                    | **Future / not implemented** delivery credentials and consent/device state   | SECURITY_SENSITIVE, PII                                                        | **Future**                             | Detailed rotation, logout, unlink, invalid-token, and consent lifecycle belongs to NOT-04.                                                                                                                        |

## 4. Existing expiry, deletion, and reconciliation mechanisms

The following mechanisms exist today. They describe runtime behavior only and
do not set unresolved retention policy:

- Auth access tokens and refresh sessions have configured expiry values; the
  current environment defaults are access-token 900 seconds and refresh-session
  2,592,000 seconds. OTP challenge, resend cooldown, rate-limit, and verification
  grant state use configured Redis/application TTLs. These are workflow/security
  expiries, not approval of post-expiry deletion windows.
- Session rows record `expiresAt` and `revokedAt`; repositories revoke
  conditionally and retain rows for later governed cleanup. Refresh-consumption
  rows carry `expiresAt` for later cleanup.
- OTP Redis scripts use atomic expiry and consume/delete behavior. Redis loss
  must not remove authoritative PostgreSQL business state.
- Commerce schedule overrides have an explicit Admin removal operation. Domain
  entities with `isActive` use deactivation where the current contract requires
  historical references to remain valid.
- Media Admin deletion is explicit and backend-authoritative. It checks durable
  references, locks the Media row, deletes the object before the metadata row,
  treats a missing object as a retry-safe success, and preserves the row when
  object deletion fails. There is no automatic orphan cleanup.
- `BlogInlineMedia` cascades only with its owning Blog row; Media consumers use
  restrictive references. Replacing a consumer reference does not delete the
  previous asset.
- Outbox dispatch uses bounded claims, expiring leases, retry/backoff, and
  recovery of expired claims. BullMQ currently has operational completion/failure
  removal settings; these do not authorize deletion of PostgreSQL outbox intent.
- Inventory reconciliation compares current balances with ledger-derived
  expectations. It is diagnostic/recovery support, not ledger cleanup.
- There is no current application cleanup job for durable records, sessions,
  refresh-consumption rows, notifications, media orphans, AuditLog, OutboxEvent,
  backups, or object-storage recovery copies.

## 5. Approved A–G decisions

The following decisions are approved and are binding inputs to later work. Any
duration not shown here remains explicitly **UNRESOLVED**.

### A — Orders, financial records, and settlement

- Order and OrderLine snapshots are durable historical transaction evidence and
  must not silently change with current User/Product/Region/Discount data.
- Order PII may have a different lifecycle from financial records; future
  anonymization such as `customerPhone` is architecturally allowed only if
  legal/accounting requirements permit it. Timing is **UNRESOLVED**.
- OrderSettlement and its receipt evidence have a linked evidence lifecycle.
- DiscountUsageRecord is append-only evidence; ordinary cleanup must not remove
  individual `CONSUME`/`RELEASE` events in a way that breaks history.
- Ordinary application lifecycle must not hard-delete Orders. Archive or
  anonymization belongs to governed DATA-03 work.

**UNRESOLVED:** Order retention duration; Order PII anonymization timing;
settlement/receipt retention duration; discount usage retention duration.

### B — Inventory and pricing

- InventoryLedger and PriceHistory are append-only histories and are not ordinary
  cleanup targets.
- ACTIVE reservations are protected. Terminal reservations may be candidates
  only after an approved safety window while Order and ledger evidence remains
  sufficient.
- PENDING idempotency records are protected from blind cleanup. COMPLETED rows
  may become candidates after an approved idempotency safety window.
- Inventory balance is current operational truth; InventoryLedger is historical
  explanation. Neither substitutes for the other.
- Order pricing snapshots and PriceHistory are independently authoritative for
  their respective meanings.

**UNRESOLVED:** InventoryLedger retention; PriceHistory retention; terminal
reservation cleanup window; completed idempotency safety window.

### C — Authentication and security lifecycle

- Active valid customer/admin sessions are protected from ordinary cleanup.
- Expired/revoked sessions may be cleaned only after an approved security/
  forensic safety window.
- Refresh-token consumption records remain available for the required reuse-
  detection window, then may become cleanup candidates after the approved window.
- OTP challenges, grants, cooldowns, and rate-limit state are intentionally
  ephemeral and must not become durable analytics history.
- Redis is not authoritative for durable business state. Session/token lifecycle
  is independent from AuditLog lifecycle, and account, session, and business
  record lifecycles remain separate.
- Credential-derived artifacts must not be retained indefinitely without a
  defined authentication/security purpose.

**UNRESOLVED:** expired/revoked session cleanup window; refresh-consumption
cleanup window.

### D — Notifications

- Notification is customer-facing communication history, not authoritative
  business history, and may have a shorter lifecycle than Orders.
- `readAt` alone is not a deletion criterion. Correctness, dispute, accounting,
  and durable operational facts must exist in authoritative domain records.
- Notification content and payload remain minimized and must not become a dump
  of sensitive DTOs. Notification lifecycle is independent of Order and AuditLog.
- Future push installation/token data is operational credential/delivery state.

**UNRESOLVED:** Notification retention; inbox cap.

**DEFER:** detailed push-token lifecycle to NOT-04.

### E — Media and orphan lifecycle

- An unreferenced Media item is not automatically orphaned; valid unreferenced
  library assets are supported.
- Lifecycle distinguishes referenced assets, valid unreferenced assets, orphan
  candidates, a DB row with a missing object, and an object with a missing DB row.
- Automatic orphan cleanup requires an approved grace period, additional safety
  checks, and race-safe protection against concurrent attachment. A first scan is
  not deletion authorization.
- Settlement receipt Media is excluded from generic orphan cleanup while required.
- A Media row with a missing object is an integrity incident, not an automatic
  row-deletion candidate. An object with no DB row may become a reconciliation/
  cleanup candidate after policy approval.
- Consumer reference replacement does not delete the old asset. Manual Admin
  deletion of unreferenced Media remains allowed with backend reference checks.
- PostgreSQL and object storage lack a distributed transaction; reconciliation
  is a first-class lifecycle and operations requirement.

**UNRESOLVED:** automatic orphan grace period; reconciliation schedule.

### F — Audit, logs, Outbox, and BullMQ

- AuditLog is durable security/operations evidence for the ADR 0023 event
  boundary. It is append-only through normal application paths, but not WORM or
  tamper-proof against privileged database access.
- AuditLog and application/security logs are independent. AuditLog lifecycle,
  if ever approved, uses a separately governed path; normal repository delete
  APIs are not the policy mechanism.
- Application logs remain minimized. The ADR 0023 boundary is preserved: ordinary
  OTP failures, CSRF failures, validation failures, and ordinary 401/403 events
  do not automatically become AuditLog rows.
- Successfully PUBLISHED OutboxEvent rows may become candidates after an
  approved operational recovery window. Non-terminal rows must never be deleted
  solely because of age; dispatcher/recovery state is required.
- BullMQ history is delivery telemetry, not business or audit truth; BullMQ
  retention values are operational tuning. Outbox/queue cleanup must preserve
  delivery and recovery guarantees.
- AuditLog must remain understandable even after application logs expire.

**UNRESOLVED:** AuditLog retention; application/security log retention; published
Outbox recovery window.

**DEFER:** BullMQ retention tuning to ASY-05/operations.

### G — Backup and disaster recovery

- Backups are the final recovery layer, not a substitute for application or
  database correctness.
- Production PostgreSQL requires automatic backup capability, risk-based/manual
  recovery points where appropriate, and demonstrated restore capability.
- Restore drills are required for production readiness; backup status alone is
  insufficient.
- High-risk/destructive production migrations require a confirmed recovery point.
- Object Storage, especially settlement receipts and referenced Media, is part of
  the disaster-recovery surface. PostgreSQL and Object Storage may use independent
  mechanisms, but restore must account for cross-system consistency and Media
  reconciliation.
- Redis is not a durable backup target. Recovery from Redis loss uses rebuild,
  retry, and re-dispatch semantics where appropriate.
- Backup lifecycle must separately account for primary deletion/anonymization and
  privacy/legal requirements. DATA-01 does not implement a generic legal-hold
  feature.
- RPO/RTO must be approved from provider capability, business tolerance, cost,
  and measured restore capability; neither is guessed from provider defaults.
- Business/legal retention requirements drive recovery requirements, not provider
  backup limitations.

**UNRESOLVED:** PostgreSQL RPO; PostgreSQL RTO; backup retention; Object Storage
recovery/retention; restore-drill cadence.

## 6. Unresolved decision register

The following durations and operational windows remain **UNRESOLVED**. No
implementation, cleanup job, or configuration default may treat them as zero,
infinite, or guessed values.

| Domain                         | Unresolved item                                       | Owning follow-up                                     |
| ------------------------------ | ----------------------------------------------------- | ---------------------------------------------------- |
| A — Orders / settlement        | Order retention duration                              | Legal/accounting review; DATA-03                     |
| A — Orders / settlement        | Order PII anonymization timing (e.g. `customerPhone`) | Legal/privacy review; DATA-03                        |
| A — Orders / settlement        | Settlement/receipt retention duration                 | Legal/accounting review; DATA-03                     |
| A — Orders / settlement        | Discount usage retention duration                     | Legal/accounting review; DATA-03                     |
| B — Inventory / pricing        | InventoryLedger retention                             | Legal/accounting review; DATA-03                     |
| B — Inventory / pricing        | PriceHistory retention                                | Legal/accounting review; DATA-03                     |
| B — Inventory / pricing        | Terminal reservation cleanup safety window            | Security/operations review; DATA-02                  |
| B — Inventory / pricing        | Completed idempotency safety window                   | Security/operations review; DATA-02                  |
| C — Authentication / security  | Expired/revoked session cleanup window                | Security review; DATA-02                             |
| C — Authentication / security  | Refresh-consumption cleanup window                    | Security review; DATA-02                             |
| D — Notifications              | Notification retention                                | Legal/privacy review; DATA-02                        |
| D — Notifications              | Inbox cap                                             | Product/privacy review; DATA-02                      |
| E — Media                      | Automatic orphan grace period                         | Operations review; DATA-02                           |
| E — Media                      | Reconciliation schedule                               | Operations review; DATA-02                           |
| F — Audit / logs / Outbox      | AuditLog retention                                    | Legal/security review; DATA-03                       |
| F — Audit / logs / Outbox      | Application/security log retention                    | Security/operations review; DATA-02                  |
| F — Audit / logs / Outbox      | Published Outbox recovery window                      | Operations review; ASY-05 / DATA-02                  |
| G — Backup / disaster recovery | PostgreSQL RPO                                        | Provider capability + business review; DEP-05/DEP-06 |
| G — Backup / disaster recovery | PostgreSQL RTO                                        | Measured restore capability; DEP-05/DEP-06           |
| G — Backup / disaster recovery | Backup retention                                      | Legal/privacy/operations review; DATA-03/DEP-05      |
| G — Backup / disaster recovery | Object Storage recovery/retention                     | Provider capability review; DEP-05/DEP-06            |
| G — Backup / disaster recovery | Restore-drill cadence                                 | Operations review; DEP-05                            |

**DEFERRED (not unresolved in DATA-01):** push-token detailed lifecycle → NOT-04;
BullMQ retention tuning → ASY-05 / operations.

## 7. Explicit invariants and rules against invented retention

1. No implementation may treat an unresolved duration as zero, infinite, or a
   default value.
2. No cleanup job, scheduled deletion, archive, anonymization, legal hold, or
   provider lifecycle rule may be added under DATA-01.
3. No ordinary delete may remove Order, OrderLine evidence, InventoryLedger,
   PriceHistory, DiscountUsageRecord, required settlement receipt evidence, or
   AuditLog evidence.
4. Current operational expiry (`expiresAt`, Redis TTL, queue removal setting,
   lease expiry, or `readAt`) is not a retention decision.
5. PostgreSQL is authoritative for durable business, session-consumption,
   outbox, and audit records. Redis and BullMQ are not substitutes for it.
6. Snapshot evidence is read from snapshots; current catalog, identity, and
   reference rows do not rewrite historical meaning.
7. Media reference checks and reconciliation must remain safe under concurrent
   attachment/replacement/deletion and cross-system failure.
8. Future push-token details, durable lifecycle enforcement, durable business
   retention/anonymization, scheduled execution, and backup implementation belong
   to their assigned roadmap tasks below.

## 8. Roadmap ownership

| Owner           | DATA-01 register boundary                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| DATA-01         | Classification, approved lifecycle principles, unresolved decision register.                                                          |
| DATA-02         | Temporary-state cleanup, session/consumption cleanup, policy-backed Notification cleanup, Media orphan/reconciliation implementation. |
| DATA-03         | Durable business-record lifecycle, archive/anonymization strategy, durable retention rules, and backup lifecycle alignment.           |
| ASY-05          | Scheduled cleanup/maintenance execution and Outbox/queue operational lifecycle execution.                                             |
| NOT-04          | Future push-installation/token detailed lifecycle.                                                                                    |
| DEP-05 / DEP-06 | Production provider configuration, backup/restore implementation and validation, and RPO/RTO/provider-capability alignment.           |

No ownership change is made here for unrelated roadmap tasks. In particular,
the known ORD-08 dependency concern remains a roadmap review item: its order
audit scope practically requires AUD-02, while the current dependency line names
AUD-01 only. Correcting that dependency is a material roadmap-governance change
and is not made by DATA-01 without the required review.

## 9. Acceptance assessment and status recommendation

| DATA-01 acceptance area                                         | Assessment                                                   | Evidence                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Legal and privacy requirements recorded per class               | PASS, with legal timing/duration items explicitly unresolved | Sections 3 and 5; PII and security classes identify legal/privacy owners for later decisions.                            |
| Volume and cost considerations recorded                         | PASS as review triggers, not invented thresholds             | Section 10; no capacity or cost number is guessed.                                                                       |
| Recovery requirements recorded per class                        | PASS, with RPO/RTO and provider facts unresolved             | Group G and backup rows in Section 3.                                                                                    |
| Access and deletion principles recorded                         | PASS                                                         | Sections 4 and 7; restrictive references, deactivation, append-only boundaries, and manual Media deletion are described. |
| Hold requirements recorded                                      | PASS as a future governance constraint                       | Group G preserves future legal/business holds without implementing a generic hold feature.                               |
| Missing retention periods remain unresolved rather than guessed | PASS                                                         | Section 6 and Group decisions; every unresolved duration is labeled **UNRESOLVED**.                                      |
| No cleanup or deletion implementation                           | PASS                                                         | Documentation-only change; current mechanisms are documented, not expanded.                                              |

The unresolved items are intentionally allowed by DATA-01. Their resolution is
owned by later legal/privacy/operations, DATA-02, DATA-03, ASY-05, NOT-04, and
DEP-05/DEP-06 work as listed above.

DATA-01 is **DONE** in [ROADMAP.md](ROADMAP.md). Human legal/privacy/operations
sign-off closed this register; independent final review passed with no BLOCKER,
HIGH, or MEDIUM findings. Unresolved durations and enforcement remain owned by
DATA-02, DATA-03, ASY-05, NOT-04, and DEP-05/DEP-06 as listed above.

## 10. Future review triggers

Re-open this register or the owning follow-up task when any of the following
changes the evidence or risk:

- real production volume, query/storage growth, or material storage-cost growth;
- legal or accounting advice, privacy requests, regulatory requirements, or a
  business/legal hold requirement;
- confirmed Liara/provider backup, object-storage lifecycle, restore, and access
  capabilities;
- restore-drill measurements or an observed recovery failure;
- the NOT-04 push installation/token design;
- new PII or credential-derived data classes;
- a new authoritative producer, consumer, event type, persistence table, or
  external recovery copy;
- a change to settlement evidence, Media reference topology, or cross-system
  reconciliation behavior.
