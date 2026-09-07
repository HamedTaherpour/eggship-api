# DATA-01 / DATA-02: Data classification and lifecycle policy register

## 1. Purpose and scope

This document is the canonical DATA-01 register and DATA-02 lifecycle policy
for EggShip. It records the current data inventory, sensitivity and lifecycle
classifications, approved lifecycle principles, approved terminal-state
retention decisions, existing expiry/deletion mechanisms, explicit invariants,
and ownership of follow-up work.

DATA-01 is a governance and documentation task. DATA-02 approves policy but
does not implement cleanup, add legal holds, or delete/anonymize data. A
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

### Lifecycle terms

- **DOMAIN_TTL** — the validity or usability lifetime of a workflow value,
  session, lease, or key. It does not authorize deletion of durable storage.
- **TERMINAL_STATE** — a state after which the domain value cannot legitimately
  continue its normal operation (for example, revoked or expired session).
- **RETENTION_AFTER_TERMINAL_STATE** — the approved safety window after the
  terminal point before a record may become cleanup-eligible.
- **CLEANUP_CANDIDATE** — a value that satisfies the policy predicate; it is
  not deletion authorization until all safety checks and the execution contract
  pass.

Some classes intentionally span concepts. For example, a current balance is
active operational state while its ledger is append-only business history;
these are not interchangeable.

## 3. Current data classification inventory

| Data class (current unless marked future)                                                    | Repository evidence / purpose                                                | Sensitivity                                                                    | Lifecycle                              | Authority and lifecycle note                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`                                                                                       | Customer identity (`phone`, active flag)                                     | PII, SECURITY_SENSITIVE                                                        | ACTIVE_OPERATIONAL_STATE               | Identity is deactivated rather than casually deleted; Orders survive account lifecycle.                                                                                                                           |
| `Admin`                                                                                      | Operator identity, role, password digest, active flag                        | PII, SECURITY_SENSITIVE                                                        | ACTIVE_OPERATIONAL_STATE               | Passwords are digest-only; deactivation is preferred and referenced records use restrictive FKs.                                                                                                                  |
| `AuthSession`, `AdminAuthSession`                                                            | Current refresh sessions, expiry, revocation, token-family state             | SECURITY_SENSITIVE                                                             | ACTIVE_OPERATIONAL_STATE               | Auth validity is a DOMAIN_TTL; expired/revoked rows become cleanup candidates only after 90 days of RETENTION_AFTER_TERMINAL_STATE, with active rows and security evidence protected.                             |
| `AuthRefreshTokenConsumption`, `AdminAuthRefreshTokenConsumption`                            | Consumed refresh digests for reuse detection                                 | SECURITY_SENSITIVE                                                             | EPHEMERAL_SECURITY                     | PostgreSQL-authoritative reuse evidence; retain for 90 days after the token family can no longer legitimately be used, using family/session expiry as authority rather than row creation time.                    |
| OTP challenges, verification grants, cooldowns, rate limits in Redis                         | OTP workflow and abuse-control state                                         | SECURITY_SENSITIVE                                                             | EPHEMERAL_SECURITY                     | Redis TTL/atomic scripts expire workflow state; it is not durable history and must not become an analytics store.                                                                                                 |
| `Order`, `OrderLine`, order snapshots                                                        | Fulfillment transaction, immutable customer/product/region/pricing snapshots | PII, FINANCIAL_BUSINESS_SENSITIVE                                              | DURABLE_BUSINESS_RECORD                | Snapshots are authoritative historical evidence; ordinary hard deletion is prohibited. PII lifecycle may differ only through governed future work.                                                                |
| `Inventory`                                                                                  | Current `onHand`/`reserved` balance                                          | FINANCIAL_BUSINESS_SENSITIVE, OPERATIONAL_SENSITIVE                            | ACTIVE_OPERATIONAL_STATE               | Current operational truth; it does not replace the ledger.                                                                                                                                                        |
| `InventoryReservation`                                                                       | Per-order/product reservation, `ACTIVE`/`RELEASED`/`SHIPPED`                 | FINANCIAL_BUSINESS_SENSITIVE                                                   | ACTIVE_OPERATIONAL_STATE               | ACTIVE is protected; RELEASED/SHIPPED rows remain durable operational evidence. No automatic retention deletion is approved.                                                                                      |
| `InventoryLedger`                                                                            | Stock movement and after-state evidence                                      | FINANCIAL_BUSINESS_SENSITIVE, OPERATIONAL_SENSITIVE                            | APPEND_ONLY_BUSINESS_HISTORY           | Append-only explanation of inventory state; individual events are not ordinary cleanup targets.                                                                                                                   |
| `InventoryCommandIdempotency`                                                                | Admin command claims and completed results                                   | OPERATIONAL_SENSITIVE, FINANCIAL_BUSINESS_SENSITIVE                            | ACTIVE_OPERATIONAL_STATE               | `PENDING` and completed history remain durable; no automatic deletion is approved because unsafe expiry could replay a mutation.                                                                                  |
| `Product.price`                                                                              | Current catalog price                                                        | FINANCIAL_BUSINESS_SENSITIVE                                                   | ACTIVE_OPERATIONAL_STATE               | Current price is not historical evidence.                                                                                                                                                                         |
| `PriceHistory`                                                                               | Catalog price-change events                                                  | FINANCIAL_BUSINESS_SENSITIVE                                                   | APPEND_ONLY_BUSINESS_HISTORY           | Append-only catalog history; ordinary cleanup must not rewrite/delete events.                                                                                                                                     |
| `Discount`                                                                                   | Admin-managed discount definition and active/window state                    | FINANCIAL_BUSINESS_SENSITIVE                                                   | ACTIVE_OPERATIONAL_STATE               | Deactivation is the lifecycle operation; order snapshots independently preserve applied discount evidence.                                                                                                        |
| `DiscountCustomerUsage`                                                                      | Current consumed lifetime quantity per customer/discount                     | PII, FINANCIAL_BUSINESS_SENSITIVE                                              | ACTIVE_OPERATIONAL_STATE               | Current aggregate supports the lifetime limit and is not a substitute for usage history.                                                                                                                          |
| `DiscountUsageRecord`                                                                        | `CONSUME`/`RELEASE` events tied to an opaque order identity                  | PII, FINANCIAL_BUSINESS_SENSITIVE                                              | APPEND_ONLY_BUSINESS_HISTORY           | Append-only historical evidence; ordinary cleanup must not break consistency.                                                                                                                                     |
| `CommerceSettings`, `CommerceScheduleOverride`                                               | Current ordering policy and date-specific override                           | INTERNAL, FINANCIAL_BUSINESS_SENSITIVE                                         | ACTIVE_OPERATIONAL_STATE               | Current policy is authoritative; override removal is an explicit business operation, not retention cleanup.                                                                                                       |
| `OrderSettlement`                                                                            | Deferred settlement state, due date, admin provenance, receipt reference     | PII, FINANCIAL_BUSINESS_SENSITIVE                                              | DURABLE_BUSINESS_RECORD                | Linked to Order and receipt evidence; receipt reference must not be removed while policy requires evidence.                                                                                                       |
| `Notification`                                                                               | Customer-facing inbox history and minimized payload                          | PII, INTERNAL                                                                  | DURABLE_BUSINESS_RECORD                | Durable independently from push delivery; no retention deletion or inbox cap is approved until usage, UX, cost, and product evidence exist.                                                                       |
| `OutboxEvent`                                                                                | PostgreSQL-authoritative event intent and dispatch/recovery state            | OPERATIONAL_SENSITIVE, FINANCIAL_BUSINESS_SENSITIVE                            | ACTIVE_OPERATIONAL_STATE               | Non-terminal rows are protected; PUBLISHED is queue acceptance, not proof that downstream recovery value has ended. No automatic deletion is approved.                                                            |
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
| Push installations/tokens                                                                    | Delivery credentials and consent/device state                                | SECURITY_SENSITIVE, PII                                                        | ACTIVE_OPERATIONAL_STATE               | NOT-04 lifecycle governs invalidation/revocation; DATA-02 adds no retention deletion policy and active delivery-eligible installations are protected.                                                             |

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

**UNRESOLVED:** InventoryLedger retention and PriceHistory retention remain
DATA-03 concerns. DATA-02 approves no automatic deletion for terminal
reservations or completed idempotency history.

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

DATA-02 approves 90 days after the relevant session terminal point and 90 days
after the associated token family can no longer legitimately be used,
respectively. Execution remains ASY-05.

### D — Notifications

- Notification is customer-facing communication history, not authoritative
  business history, and may have a shorter lifecycle than Orders.
- `readAt` alone is not a deletion criterion. Correctness, dispute, accounting,
  and durable operational facts must exist in authoritative domain records.
- Notification content and payload remain minimized and must not become a dump
  of sensitive DTOs. Notification lifecycle is independent of Order and AuditLog.
- Future push installation/token data is operational credential/delivery state.

DATA-02 intentionally retains notifications and approves no inbox cap for now.
Review is triggered by actual volume, UX, cost, or product/privacy evidence.

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

DATA-02 approves a seven-day grace period only for object-only candidates and a
daily target schedule for future ASY-05 reconciliation. A Media row without an
object remains a report/recovery case, not a delete candidate.

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

**UNRESOLVED:** AuditLog retention and application/security log retention remain
separately governed. DATA-02 retains published Outbox and async failure/replay
history for now; publication is not recovery completion.

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

## 6. Remaining unresolved decision register

The following durations and operational windows remain **UNRESOLVED**. No
implementation, cleanup job, or configuration default may treat them as zero,
infinite, or guessed values.

| Domain                         | Unresolved item                                       | Owning follow-up                                       |
| ------------------------------ | ----------------------------------------------------- | ------------------------------------------------------ |
| A — Orders / settlement        | Order retention duration                              | Legal/accounting review; DATA-03                       |
| A — Orders / settlement        | Order PII anonymization timing (e.g. `customerPhone`) | Legal/privacy review; DATA-03                          |
| A — Orders / settlement        | Settlement/receipt retention duration                 | Legal/accounting review; DATA-03                       |
| A — Orders / settlement        | Discount usage retention duration                     | Legal/accounting review; DATA-03                       |
| B — Inventory / pricing        | InventoryLedger retention                             | Legal/accounting review; DATA-03                       |
| B — Inventory / pricing        | PriceHistory retention                                | Legal/accounting review; DATA-03                       |
| B — Inventory / pricing        | Terminal reservation cleanup safety window            | DATA-02: retain for now; no automatic deletion         |
| B — Inventory / pricing        | Completed idempotency safety window                   | DATA-02: retain for now; replay-safety redesign needed |
| C — Authentication / security  | Expired/revoked session cleanup window                | DATA-02: 90 days after terminal point                  |
| C — Authentication / security  | Refresh-consumption cleanup window                    | DATA-02: 90 days after family can no longer be used    |
| D — Notifications              | Notification retention                                | DATA-02: retain for now; product/usage review needed   |
| D — Notifications              | Inbox cap                                             | DATA-02: no cap approved; product decision needed      |
| E — Media                      | Automatic orphan grace period                         | DATA-02: 7 days for object-only candidates             |
| E — Media                      | Reconciliation schedule                               | DATA-02: daily target; ASY-05 execution                |
| F — Audit / logs / Outbox      | AuditLog retention                                    | Legal/security review; DATA-03                         |
| F — Audit / logs / Outbox      | Application/security log retention                    | Provider/deployment policy; no DATA-02 duration        |
| F — Audit / logs / Outbox      | Published Outbox recovery window                      | DATA-02: retain for now; future recovery policy        |
| G — Backup / disaster recovery | PostgreSQL RPO                                        | Provider capability + business review; DEP-05/DEP-06   |
| G — Backup / disaster recovery | PostgreSQL RTO                                        | Measured restore capability; DEP-05/DEP-06             |
| G — Backup / disaster recovery | Backup retention                                      | Legal/privacy/operations review; DATA-03/DEP-05        |
| G — Backup / disaster recovery | Object Storage recovery/retention                     | Provider capability review; DEP-05/DEP-06              |
| G — Backup / disaster recovery | Restore-drill cadence                                 | Operations review; DEP-05                              |

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

| Owner           | DATA-01 register boundary                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| DATA-01         | Classification, approved lifecycle principles, unresolved decision register.                                                   |
| DATA-02         | Temporary-state and orphan lifecycle policy; session/consumption retention; Media reconciliation contract; explicit deferrals. |
| DATA-03         | Durable business-record lifecycle, archive/anonymization strategy, durable retention rules, and backup lifecycle alignment.    |
| ASY-05          | Scheduled cleanup/maintenance execution and Outbox/queue operational lifecycle execution.                                      |
| NOT-04          | Future push-installation/token detailed lifecycle.                                                                             |
| DEP-05 / DEP-06 | Production provider configuration, backup/restore implementation and validation, and RPO/RTO/provider-capability alignment.    |

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

The remaining unresolved items are intentionally retained by DATA-01/DATA-02.
Their resolution is owned by later legal/privacy/operations, DATA-03, ASY-05,
NOT-04, and DEP-05/DEP-06 work as listed above.

DATA-01 is **DONE** and DATA-02 is **DONE** in [ROADMAP.md](ROADMAP.md).
DATA-02 is a policy/lifecycle-contract completion: no cleanup job, provider
execution, or deletion was performed. Future enforcement remains owned by
ASY-05; durable retention and backup lifecycle remain owned by DATA-03.

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

## 11. DATA-02 approved retention matrix

The following is the approved POLICY / LIFECYCLE-CONTRACT boundary. Each row
names the dataset owner, storage authority, terminal or expiry condition,
retention authority, future cleanup mechanism, deletion invariant,
sensitivity, implementation owner, and provider-verification requirement.

| Dataset / owner                                                                           | Storage                                                   | Terminal / expiry condition                                                       | Approved retention authority                                      | Cleanup mechanism                                                 | Deletion safety invariant                                                                                                      | Sensitivity                                           | Implementation owner          | Provider verification                                      |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| Customer and Admin sessions / Auth                                                        | PostgreSQL                                                | `expiresAt` reached or `revokedAt` set; domain TTL is separate from row retention | 90 days after the relevant terminal point                         | ASY-05 bounded PostgreSQL cleanup                                 | Never remove active/unexpired sessions or evidence still needed for refresh-token reuse/security detection                     | SECURITY_SENSITIVE, PII                               | ASY-05 after DATA-02          | Required before hosted execution; not performed by DATA-02 |
| Refresh-token consumption / Auth                                                          | PostgreSQL                                                | Associated token family can no longer legitimately be used                        | 90 days after safe family-expiry authority, not row creation time | ASY-05 bounded PostgreSQL cleanup                                 | Preserve all evidence needed to detect reuse; family/session expiry is authoritative                                           | SECURITY_SENSITIVE                                    | ASY-05 after DATA-02          | Required before hosted execution; not performed by DATA-02 |
| OTP, grants, consumed markers, cooldowns, and rate limits / Auth                          | Redis                                                     | Native key TTL or atomic consume state expires                                    | Redis TTL is authoritative; no post-TTL durable retention         | Native Redis TTL only; no scheduled cleanup                       | Never use `FLUSHDB`; Redis loss must not delete durable business state                                                         | SECURITY_SENSITIVE                                    | Auth / Redis foundation       | Verify configured TTL behavior before hosted execution     |
| Visitor and referral attribution / Referrals                                              | PostgreSQL                                                | Visitor deactivation; attribution is immutable registration evidence              | Retain durable attribution; no DATA-02 deletion policy            | None approved                                                     | Do not delete or rewrite `ReferralAttribution` as temporary state                                                              | PII, INTERNAL                                         | DATA-03 / Referrals           | Not applicable until a future policy                       |
| Inventory reservations / Inventory                                                        | PostgreSQL                                                | `RELEASED` or `SHIPPED` is terminal; `ACTIVE` is live                             | Retain for now; no automatic deletion                             | None approved                                                     | Durable operational evidence remains available for reconciliation                                                              | FINANCIAL_BUSINESS_SENSITIVE                          | Future policy review          | Not applicable until a future policy                       |
| Inventory idempotency / Inventory                                                         | PostgreSQL                                                | Completed command history is not a deletion signal                                | Retain for now; replay safety must be redesigned first            | None approved                                                     | An old retry must not execute a mutation again                                                                                 | OPERATIONAL_SENSITIVE, FINANCIAL_BUSINESS_SENSITIVE   | Future policy review          | Not applicable until a future policy                       |
| Notifications / Notifications                                                             | PostgreSQL                                                | Read state is not a terminal deletion signal                                      | Retain for now; no inbox cap                                      | None approved                                                     | Do not infer retention from `readAt`; preserve minimized history                                                               | PII, INTERNAL                                         | Future product/privacy review | Not applicable until a future policy                       |
| Push installations / Notifications                                                        | PostgreSQL                                                | NOT-04 invalidation/revocation semantics                                          | DATA-02 adds no retention duration                                | Existing NOT-04 lifecycle only                                    | Never delete active delivery-eligible installations                                                                            | SECURITY_SENSITIVE, PII                               | NOT-04                        | Provider evidence required before retention policy changes |
| Media object-only candidates / Media                                                      | Object Storage + PostgreSQL `Media.storageKey` comparison | Owned object has no matching Media row and is at least 7 days old                 | 7-day grace period; re-check immediately before deletion          | Future ASY-05 daily reconciliation, dry-run then bounded deletion | Owned namespace only; provider verification, re-check, reference safety, and retry-safe partial failure handling are mandatory | INTERNAL, OPERATIONAL_SENSITIVE                       | ASY-05 after DATA-02          | Mandatory before destructive execution                     |
| Media DB rows with missing objects / Media                                                | PostgreSQL + Object Storage                               | DB row exists but provider object is missing                                      | No auto-delete; diagnostic/recovery case                          | Report and recovery workflow                                      | Report broken relationship; never delete the DB row automatically                                                              | INTERNAL, OPERATIONAL_SENSITIVE                       | MED-02 / ASY-05 diagnostics   | Provider read/list verification required                   |
| Published outbox / Async                                                                  | PostgreSQL                                                | `PUBLISHED` means queue acceptance only                                           | Retain for now; future recovery-retention approval required       | None approved                                                     | Do not treat publication as proof that downstream recovery value ended                                                         | OPERATIONAL_SENSITIVE                                 | ASY-05 / future policy        | Provider verification required for any future execution    |
| Async failure/replay history / Async                                                      | PostgreSQL and BullMQ operational state                   | Failure/replay evidence remains operationally useful                              | Retain for now                                                    | None approved                                                     | Preserve incident and recovery evidence                                                                                        | OPERATIONAL_SENSITIVE                                 | ASY-05 / operations           | Provider verification required for any future execution    |
| Application/security logs / Observability                                                 | Provider/deployment logging system                        | Provider policy or approved operational lifecycle                                 | No duration invented by DATA-02                                   | Provider/deployment policy                                        | Minimize and redact; never log secrets or unnecessary PII                                                                      | SECURITY_SENSITIVE, OPERATIONAL_SENSITIVE, PII        | Operations / provider         | Provider policy must be verified                           |
| Orders, settlements, ledger, price/discount history, AuditLog, and backups / Durable data | PostgreSQL and provider recovery copies                   | Domain-specific terminal/recovery conditions                                      | DATA-03 / DEP-05; no DATA-02 destructive retention                | None approved by DATA-02                                          | No hard deletion, anonymization, or backup expiry under this task                                                              | PII, FINANCIAL_BUSINESS_SENSITIVE, SECURITY_SENSITIVE | DATA-03 / DEP-05              | Provider recovery and restore proof is required later      |

DOMAIN_TTL is the time a value remains valid or usable. RETENTION_AFTER_TERMINAL_STATE
is the separate safety interval before durable cleanup eligibility. A session
may have an expired authentication TTL while its PostgreSQL row remains retained
for 90 days. No DATA-02 row authorizes deletion by age alone.

## 12. Media reconciliation contract

Future ASY-05 execution must keep reconciliation and deletion conceptually
separate. For object-to-database reconciliation it must:

1. enumerate keys only under EggShip's server-owned media namespace;
2. compare each key with `Media.storageKey` in PostgreSQL;
3. detect object-only candidates and reject keys younger than seven days;
4. support dry-run/report mode before any destructive action;
5. verify the object with the provider and re-check the database immediately
   before deletion, including reference state and namespace ownership;
6. delete in bounded batches;
7. record safe outcome metrics; and
8. tolerate retries and partial provider failures without converting an
   uncertain result into deletion authorization.

For DB-to-object reconciliation, a `Media` row whose object is missing is a
reported broken relationship and diagnostic/recovery case. It must not
automatically delete the database row or its business references.

## 13. Redis and future PostgreSQL cleanup contracts

Native Redis TTL remains authoritative for OTP challenges, verification grants,
consumed markers, cooldowns, phone/IP rate limits, and other explicitly
ephemeral keys. Correctly TTL-managed state needs no scheduled cleanup. Never
propose production `FLUSHDB`.

Future PostgreSQL cleanup requires bounded batches, indexed predicates, stable
ordering, short transactions, overlap-safe behavior, and `SKIP LOCKED` where
justified. It must support dry-run/manual mode, retry-safe execution, a volume
circuit breaker, structured metrics, and PII-free logs. DATA-02 does not create
these jobs.

## 14. Cleanup observability and stop conditions

Every future cleanup run must record: dataset/category, `dryRun`, policy version,
cutoff, scanned, eligible, deleted, skipped, failed, batch count, duration,
and a run/correlation/job identifier. Logs must not contain PII, tokens,
storage credentials, or object contents.

Execution must stop and require operator review when provider identity or
namespace cannot be verified, the candidate volume exceeds the configured
circuit breaker, a re-check disagrees with the scan, deletion outcomes are
ambiguous, lock/contention behavior is abnormal, or failure/retry rates suggest
an incident or partial provider outage.

## 15. DATA-02 review triggers and handoffs

Revisit a `retain for now` decision when production launch is imminent where
relevant, storage growth is meaningful, cleanup/query performance degrades,
provider cost becomes material, a privacy/compliance requirement appears,
incident or recovery experience changes evidence needs, notification UX needs a
history cap, or idempotency replay guarantees are redesigned. These are
evidence-triggered reviews, not arbitrary calendar deadlines.

ASY-05 may implement only the approved session and refresh-consumption cleanup,
object-only Media reconciliation/deletion after provider verification, native
Redis TTL verification, and the operational cleanup observability framework.
ASY-05 must not delete reservations, inventory idempotency history,
notifications/inbox, published outbox, async failure/replay history, or durable
business/audit data.

DATA-03 retains ownership of durable business/history retention, AuditLog
retention, required anonymization, backup/recovery-copy lifecycle, and RPO/RTO
policy interaction. DATA-02 does not start DATA-03, ASY-05, or provider work.
