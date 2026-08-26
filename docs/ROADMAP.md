# EggShip API implementation roadmap

This is the authoritative execution plan for completing the standalone EggShip API. It records implementation state and dependency order; [CHANGELOG.md](../CHANGELOG.md) records delivered changes. All work remains subject to [AGENTS.md](../AGENTS.md), the relevant engineering instructions, accepted ADRs, and the [Definition of Done](../instructions/definition-of-done.md).

## Progress summary

| Measure     | Count |
| ----------- | ----: |
| Total       |   103 |
| DONE        |    47 |
| IN_PROGRESS |     0 |
| READY       |     1 |
| BLOCKED     |     1 |
| PLANNED     |    54 |

- Current task: none in progress. One READY task: `CAT-05 — Admin catalog APIs`. `ORD-03A` is DONE (customer Order-create HTTP + User/Region transaction-context join). `SET-01` remains the separate BLOCKED settlement decision task.
- Current milestone: `M1 — Foundation complete`. `AUTH-01`–`AUTH-08`, `ADM-00`, and `ADM-AUTH-01` are DONE. The `M2 — Identity complete` task list is closed for customer identity and Admin login runtime, but CSRF middleware for cookie-authenticated browser mutations remains a production blocker, so M2 must not be reported as production-ready.

## Status model

- `DONE`: acceptance criteria and the Definition of Done are satisfied.
- `IN_PROGRESS`: implementation is actively underway.
- `READY`: dependencies and required decisions are complete; work may start.
- `BLOCKED`: a named architecture or business decision prevents safe progress.
- `PLANNED`: scoped but waiting on dependencies or sequencing.

## Execution and review model

Codex is the default primary agent for bounded implementation, migrations, tests, and specified infrastructure work. Claude/Cursor is the default adversarial reviewer for architecture, security, concurrency, and large-context impact. Human approval through the Human + ChatGPT architecture process is mandatory for unresolved business semantics, security strategy, architecture changes, destructive migrations, major dependencies, retention rules, and production cutover. AI review never substitutes for required human approval.

Each task must start with a context packet containing:

- required context and the precise requirement being implemented;
- relevant instruction files and ADRs;
- relevant domain decisions or legacy-contract evidence; and
- affected files/modules plus the smallest useful neighboring code.

Do not load unrelated domain implementations by default. Agents should follow referenced contracts across module boundaries only when the task depends on them.

## Dependency spine

```text
Foundation → Identity → Catalog → Inventory → Orders
                         Pricing ────────┘
                 Commerce Policy ───────┤
          Discount Lifetime Usage ──────┤
                         Settlement ← Delivered Orders + Media

Redis/BullMQ foundation → Transactional Outbox → Business-critical delivery workers

Feature parity → Reliability and data lifecycle → Liara readiness → Migration/cutover
```

Tasks may be executed across phases when their explicit dependencies allow it. Dependencies, not phase numbers alone, control execution. No task may introduce a circular module or roadmap dependency.

## Cross-cutting acceptance rule

Every implementation task applies the repository Definition of Done. Relevant work must cover the API contract, strict validation, authentication, authorization and ownership, structured errors, OpenAPI, database constraints, transactions, concurrency, idempotency, observability, audit/privacy, tests, performance, documentation, and changelog without copying that checklist into every task. Non-applicable concerns must be recorded in the task handoff.

## Phase 0 — Foundation

### FND-01 — Repository bootstrap

Status: DONE | Depends on: None | Primary: Codex | Review: Claude/Cursor

Scope: Establish the NestJS/TypeScript repository, PostgreSQL/Prisma foundation, configuration, tooling, CI, and health route.

Acceptance criteria: The current repository contains the strict toolchain, application bootstrap, Prisma boundary, `/api/v1/health`, and baseline verification scripts.

Explicitly out of scope: Business modules and production deployment automation.

### FND-02 — Foundation audit and hardening

Status: DONE | Depends on: FND-01 | Primary: Codex | Review: Claude/Cursor

Scope: Audit and harden validation, API errors, application setup, testing, and secret-safe configuration.

Acceptance criteria: Production and e2e bootstrap share global behavior; internal errors are sanitized; foundation regression tests exist.

Explicitly out of scope: Feature-specific contracts.

### FND-03 — Observability foundation

Status: DONE | Depends on: FND-02 | Primary: Codex | Review: Claude/Cursor

Scope: Provide provider-independent structured logging, request/correlation context, redaction, and release metadata.

Acceptance criteria: Existing code and tests demonstrate request IDs, correlation isolation, safe completion/error logs, and central redaction.

Explicitly out of scope: External monitoring vendors and business audit logs.

### FND-04 — Governance review

Status: DONE | Depends on: FND-01 | Primary: Human + ChatGPT architecture process | Review: Human architecture owner

Scope: Establish architecture, API, quality, database, testing, security, observability, release, AI-governance, and completion policies.

Acceptance criteria: `AGENTS.md` is the canonical entry point and all current policy documents are linked and internally consistent.

Explicitly out of scope: Approving unspecified business rules.

### AI-01 — AI workspace and tooling integration

Status: DONE | Depends on: FND-04 | Primary: Cursor | Review: Claude/Cursor

Scope: Add Cursor, Claude, and Codex project adapters that point at canonical `AGENTS.md` / `instructions/*` policy, shared agent workflows, MCP governance, model-independence rules, and lightweight adapter validation—without implementing business features.

Acceptance criteria:

- Tool-specific directories act as thin adapters rather than duplicated policy systems.
- Shared workflows exist for roadmap implementation and adversarial/migration/concurrency review.
- MCP policy documents that no project-scoped MCP is enabled yet.
- `pnpm check:agent-tooling` verifies adapter drift guards.

Explicitly out of scope: Business features, Auth/OpenAPI/domain modules, installing MCP servers, and inventing unsupported host config formats.

### AI-02 — Qoder workspace integration

Status: DONE | Depends on: AI-01 | Primary: Qoder | Review: Human

Scope: Add Qoder project rules and skills as thin adapters around canonical `AGENTS.md` / `instructions/*` policy and shared agent workflows, extend adapter validation to cover `.qoder/`, and keep Cursor/Claude/Codex compatibility—without implementing business features.

Acceptance criteria:

- `.qoder/rules` contains minimal governance, architecture, database, testing, security, and roadmap-task adapters pointing to canonical sources.
- `.qoder/skills` contains thin wrappers for `implement-roadmap-task`, `review-eggship-change`, `review-prisma-migration`, and `review-concurrency-sensitive-change` that delegate to shared workflows.
- `instructions/agent-tooling.md` explicitly covers Qoder as a host adapter.
- `pnpm check:agent-tooling` validates `.qoder/` drift guards without making Qoder mandatory for runtime/builds.
- No MCP server is added and no business feature is implemented.

Explicitly out of scope: Business features, installing MCP servers, duplicating large policy sections, and making Qoder mandatory for non-tooling workflows.

### INF-01 — Redis and BullMQ infrastructure foundation

Status: DONE | Depends on: FND-03, FND-04 | Primary: Codex | Review: Claude/Cursor

Scope: Add optional Redis lifecycle/readiness and reusable BullMQ, job-envelope, failure-reporting, and correlation primitives.

Acceptance criteria: Redis is optional when unconfigured, configured failures are loud and secret-safe, queue defaults are overridable, and no business queue or worker exists.

Explicitly out of scope: Caches, outbox storage, business jobs, and a worker entrypoint.

### FND-05 — OpenAPI foundation

Status: DONE | Depends on: FND-02 | Primary: Codex | Review: Claude/Cursor

Scope: Add the approved Nest OpenAPI setup, versioned documentation endpoint policy, security-scheme placeholders, and contract-generation checks.

Acceptance criteria:

- Health and foundation error/response shapes are accurately represented without exposing internal models.
- A deterministic OpenAPI artifact or verification path detects undocumented contract drift.

Explicitly out of scope: Feature endpoints and choosing an authentication strategy.

### FND-06 — Local and remote environment workflow

Status: DONE | Depends on: FND-05 | Primary: Codex | Review: Claude/Cursor

Scope: Document and verify Docker-free local workflows for PostgreSQL and optional isolated remote Redis, including safe test-environment selection.

Acceptance criteria: A developer can run normal install/start/check commands without Docker; production infrastructure cannot be selected accidentally by documented test workflows.

Explicitly out of scope: Provisioning production services or embedding credentials.

### FND-07 — Real infrastructure integration-test strategy

Status: DONE | Depends on: FND-06 | Primary: Codex | Review: Claude/Cursor, Human infrastructure review

Scope: Define opt-in real PostgreSQL and Redis integration targets, isolation, cleanup, CI/staging ownership, and failure behavior.

Acceptance criteria: Targets fail rather than pass when required infrastructure was not contacted; ordinary local unit/e2e suites remain network-independent.

Explicitly out of scope: Mock-only tests labeled as integration tests and mandatory laptop Docker.

### FND-08 — Release automation foundation

Status: DONE | Depends on: FND-05, FND-07 | Primary: Codex | Review: Claude/Cursor, Human release review

Scope: Define version/tag validation, artifact checks, changelog gates, and a GitHub Release workflow appropriate to the first deployable milestone.

Acceptance criteria: Release automation is reproducible, preserves explicit migration/deployment approval, and includes application version/Git SHA metadata.

Explicitly out of scope: Liara deployment and autonomous production releases.

## Phase 1 — Authentication, Identity & Access

### AUTH-01 — Identity and authentication architecture

Status: DONE | Depends on: FND-05 | Primary: Human + ChatGPT architecture process | Review: Claude/Cursor security review, Human approval

Scope: Approve identity boundaries and the user/customer/store relationship, access-token transport/lifetime, browser cookie and CSRF strategy compatible with the EggShip frontend, admin authentication separation, password policy, and threat model.

Acceptance criteria: Decisions and unresolved risks are documented before schema or endpoints; secrets, cookies, token storage, CORS, and account-enumeration behavior are explicit.

Explicitly out of scope: Implementing authentication or selecting an SMS provider.

### AUTH-02 — User and session persistence

Status: DONE | Depends on: AUTH-01 | Primary: Codex | Review: Claude/Cursor, Human migration review

Scope: Add user, credential, refresh-session/token-family, revocation, and required uniqueness/index models with reviewed migrations.

Acceptance criteria: Raw passwords and refresh tokens are never stored; constraints support rotation, reuse detection, revocation, expiry, and concurrent requests.

Explicitly out of scope: OTP state, profile endpoints, and role administration.

### AUTH-03 — Password login and access tokens

Status: DONE | Depends on: AUTH-02 | Primary: Codex | Review: Claude/Cursor security review

Scope: Implement password hashing/verification, customer and approved admin login flows, access-token issuance/validation, guards, and structured authentication errors.

Acceptance criteria: Hash parameters and token claims follow AUTH-01; timing/account-enumeration risks are addressed; unit, integration, e2e, and OpenAPI coverage exist.

Explicitly out of scope: Refresh rotation, OTP, permissions, and social login.

### AUTH-04 — Refresh-session lifecycle and logout

Status: DONE | Depends on: AUTH-02, AUTH-03 | Primary: Codex | Review: Claude/Cursor security/concurrency review

Scope: Implement refresh rotation, atomic token-family advancement, reuse detection, current-session revocation, logout current session, and logout all sessions.

Acceptance criteria: Concurrent refresh attempts cannot produce multiple valid successors; detected reuse applies the approved revocation response; cookie clearing matches AUTH-01.

Explicitly out of scope: Device dashboards and arbitrary admin impersonation.

### AUTH-05 — OTP policy, temporary state, and abuse controls

Status: DONE | Depends on: AUTH-01, INF-01 | Primary: Human + ChatGPT architecture process | Review: Claude/Cursor security review, Human approval

Scope: Approve and implement OTP purpose/identity binding, TTL, one-time-use semantics, attempt limits, resend/rate-limit keys, lock behavior, Redis outage behavior, provider-independent SMS port (development + Kavenegar adapters), and Redis-backed OTP/abuse primitives without HTTP login/session issuance.

Acceptance criteria: Redis remains non-authoritative for durable sessions; OTP digests use a keyed HMAC; atomic consume and abuse controls are implemented and tested; development fixed OTP is adapter/config-only; production refuses the development provider; Kavenegar adapter is documentation-backed without inventing credentials.

Explicitly out of scope: Public OTP HTTP endpoints, registration/session issuance, Admin login, and live Kavenegar credentialed smoke tests.

### AUTH-06 — OTP request and verification

Status: DONE | Depends on: AUTH-05 | Primary: Codex | Review: Claude/Cursor security/concurrency review

Scope: Expose public OTP request/verify HTTP APIs that orchestrate AUTH-05 OTP application primitives, with enumeration-safe responses and OpenAPI, without registration or session issuance side effects.

Acceptance criteria: HTTP request/verify contracts are documented; OTP remains one-time under concurrency; logs expose no code or contact PII; development responses never echo OTP values.

Explicitly out of scope: Production SMS credential smoke tests (pending Kavenegar account access), registration side effects, and access/refresh session issuance.

### AUTH-07 — Registration and customer/store profile

Status: DONE | Depends on: AUTH-03, AUTH-06 | Primary: Codex | Review: Claude/Cursor

Scope: Implement approved customer/store registration, current-user retrieval, and bounded profile update with ownership and mass-assignment protection.

Acceptance criteria: Identity uniqueness, user-to-customer/store relationships, and verified-identifier rules are transactional; response DTOs and OpenAPI exclude credential/session fields; update allowlists are explicit.

Explicitly out of scope: Referral rewards, store administration, and arbitrary user editing.

### AUTH-08 — RBAC, permissions, and ownership enforcement

Status: DONE | Depends on: AUTH-03, AUTH-07 | Primary: Human + ChatGPT architecture process, then Codex | Review: Claude/Cursor security review, Human approval

Scope: Approve and implement admin roles/permissions, authorization guards/policies, resource ownership checks, and denial audit hooks.

Acceptance criteria: Default denial and server-side ownership are enforced; authentication remains distinct from authorization; permission tests cover customer/admin boundaries.

Explicitly out of scope: Inventing organization tenancy or granting implicit superuser access.

Delivered: code-defined `Permission` catalog and `AdminRole` → permission policy ([ADR 0007](adr/0007-authorization-model.md)), `AuthorizationService`, `@RequirePermissions` (ALL semantics), `PermissionGuard`, `AdminRoleResolver` port with a fail-closed default supplied through `AuthorizationModule.forRoot()`, principal-derived customer ownership scoping, `AUTH_FORBIDDEN` (403), and the `authz.denied` security log. Access-token claims are unchanged: no role or permission snapshot.

Completed by ADM-00: Admin identity persistence, the `email` login identifier, `PrismaAdminRoleResolver` wiring, and the settled wrong-subject 403 contract.

`ADM-AUTH-01` owns Admin session persistence, login/refresh/logout HTTP, ADMIN access-token issuance, namespaced Admin cookies, and operator-controlled first-`SUPER_ADMIN` provisioning. `ADM-01` owns general Admin account management.

Owed by the first permissioned admin HTTP surface (`ADM-01` or the earliest admin management/catalog API): an architecture test asserting every registered admin route carries `AccessTokenGuard`, `PermissionGuard`, and permission metadata, except the AUTH-lifecycle allowlist on `/admin/auth/*` (public login/refresh/logout; `/me` and logout-all authenticate without a permission). Guard attachment is the one authorization failure mode that cannot fail closed on its own.

## Phase 2 — Core Reference & Catalog

### CAT-01 — List, pagination, search, filter, and sort primitives

Status: DONE | Depends on: FND-05 | Primary: Codex | Review: Claude/Cursor

Scope: Implement narrow reusable request/response primitives that enforce the approved pagination envelope and resource-owned filter/sort allowlists.

Acceptance criteria: Page defaults/maximums, stable ordering, invalid filters/sorts, search normalization, OpenAPI, and query performance expectations are tested.

Explicitly out of scope: Generic CRUD services/repositories and resource-specific queries.

Delivered: `src/common/list` pagination/search/sort helpers and query DTOs, strict integer/boolean query parsers, resource-owned `createSortQueryDto` allowlists with defaults, `toPaginatedResponse` / OpenAPI `createPaginatedResponseDto`, Prisma-neutral page types, `instructions/list-queries.md`, and unit plus test-only e2e validation coverage. No business list endpoints.

### CAT-02 — Category and region reference models

Status: DONE | Depends on: CAT-01 | Primary: Codex | Review: Claude/Cursor, Human migration review

Scope: Define category hierarchy/identity and region/reference data models plus admin-safe lifecycle constraints.

Acceptance criteria: Required legacy fields and historical relationships are evidenced; uniqueness, ordering, activation, and deletion/reference rules are constrained and migrated safely.

Explicitly out of scope: Products, inventory, shipping-price rules, and speculative geography.

Delivered: Minimal `Category` / `Region` Prisma models and additive migration (`id`, trimmed `name`, `isActive`, timestamps; no slug/hierarchy/uniqueness — MIG-01 gaps documented); public active full lists; Admin list/create/update with `CATALOG_READ`/`CATALOG_MANAGE`; deactivation preferred over hard delete; `instructions/catalog.md`; unit/e2e coverage. PostgreSQL integration specs exist; live `TEST_DATABASE_URL` run not executed in this environment.

### CAT-03 — Product catalog and price representation

Status: DONE | Depends on: CAT-02 | Primary: Codex | Review: Claude/Cursor, Human migration review

Scope: Define products and catalog relationships, with monetary values represented as integer Toman and no inventory fields owned by Product.

Acceptance criteria: Product/category/media relationships and public/admin visibility are explicit; constraints prevent invalid money and ambiguous identifiers; response DTOs are persistence-independent.

Explicitly out of scope: Inventory state, price history, discounts, and cache implementation.

Delivered: Minimal `Product` Prisma model and additive migration (`id`, trimmed `name`, integer Toman `price` with `CHECK (price > 0)`, `categoryId` FK `ON DELETE RESTRICT`, `isActive`, timestamps; no SKU/description/media/inventory — MIG-01/MED-01/INV-01B gaps documented); ADR 0010; public paginated list/detail (active product + active Category); Admin list/detail/create/update with `CATALOG_READ`/`CATALOG_MANAGE`; CAT-01 query support; `instructions/catalog.md` Product boundaries; unit/e2e coverage. PostgreSQL integration specs exist; live `TEST_DATABASE_URL` run not executed in this environment. Media relationship deferred to MED-01 (CAT-04 delivered reusable Media, not Product attachment).

### CAT-04 — Media library metadata

Status: DONE | Depends on: FND-05 | Primary: Codex | Review: Claude/Cursor, Human migration review

Scope: Reusable Media domain for Admin Media Library: metadata persistence, provider-independent object storage, validated single and bounded multi-file upload, list/search/filter/sort, derived public URLs, and safe deletion. Architecture owner approved improving the legacy one-file-at-a-time UX so Admin can upload multiple files in one workflow with independent per-file results. Media is not owned by Product; Product/Blog/Category attachment remains later work.

Acceptance criteria: Media rows store identity and metadata only (no PostgreSQL binaries); storage keys are server-generated; uploads validate content/size/batch bounds; mixed batch outcomes persist successes independently; Admin list/detail/delete exist; orphan and deletion semantics are documented; production cannot silently fall back to local disk or in-memory storage.

Explicitly out of scope: Product/Blog/Category media attachment, GIF/SVG, private-media ACL, content deduplication, image transformation, reconciliation workers, and live production-bucket verification.

Delivered: Reusable `Media` metadata model and additive migration (`id`, unique server-generated `storageKey`, `originalFileName`, `mimeType`, `sizeBytes`, optional `width`/`height`, timestamps; no binaries, no Product FK); `StorageProvider` port with in-memory (test/dev) and S3-compatible adapters (`@aws-sdk/client-s3`; production forbids memory/disk fallback); Admin `POST /api/v1/admin/media/upload` (`files` multipart, single or bounded batch) with independent per-file results and HTTP 200 on mixed outcomes; `GET /api/v1/admin/media`, `GET /api/v1/admin/media/:id`, `DELETE /api/v1/admin/media/:id` gated by existing `MEDIA_READ` / `MEDIA_MANAGE`; JPEG/PNG/WebP magic-byte validation (SVG/GIF rejected); configurable upload bounds with multer + aggregate stream caps; bounded upload concurrency; derived public URLs (no persisted host); ADR 0011; `instructions/media.md`. Architecture owner approved multi-file upload as the product improvement over legacy one-at-a-time. PostgreSQL integration specs exist; live `TEST_DATABASE_URL` and live object-storage suites were not executed in this environment.

### CAT-05 — Admin catalog APIs

Status: READY | Depends on: AUTH-08, CAT-02, CAT-03, CAT-04 | Primary: Codex | Review: Claude/Cursor

Scope: Close remaining authorized catalog Admin API gaps after CAT-02/CAT-03/CAT-04. Category, region, product, and media metadata management APIs already exist; this task must not re-implement CAT-04 uploads.

Acceptance criteria: Remaining catalog Admin contract gaps (if any after CAT-02–CAT-04) have validation, permission matrix, list semantics, conflict/deletion behavior, OpenAPI, audit hooks, and integration/e2e coverage.

Explicitly out of scope: Inventory mutations, re-implementing Media upload/storage, and discounts.

### CAT-06 — Public catalog APIs

Status: DONE | Depends on: CAT-03, CAT-04 | Primary: Codex | Review: Claude/Cursor

Scope: Implement public category/product list and detail contracts with explicit visibility, pagination, search, filters, and sorting.

Acceptance criteria: Only public/active records and safe fields are returned; query plans avoid N+1 behavior; legacy contract differences are recorded for migration.

Delivered: Closed public storefront contract on CAT-02/CAT-03 foundations — active-only Category full list (`id`/`name`, no query params, unknown queries rejected); paginated public Product list/detail with active Product + active Category visibility, CAT-01 pagination/search(name)/`categoryId`/sort allowlist (`name`/`price`/`createdAt`/`updatedAt`, default `name`/`asc`), safe public DTOs (no Admin lifecycle or inventory), N+1-safe Category activity filter without nested hydration, OpenAPI `Categories_list` / `Products_list` / `Products_get`, and MIG-01 public-contract deltas in `instructions/catalog.md`. No Product↔Media, inventory authority, personalized pricing, or Redis caching.

Explicitly out of scope: Inventory authority, personalized pricing, and Redis caching.

## Phase 3 — Inventory

### INV-01A — Inventory architecture and invariants

Status: DONE | Depends on: CAT-03 | Primary: Human + ChatGPT architecture process | Review: Claude/Cursor concurrency review, Human approval

Scope: Approve Inventory quantity semantics (`onHand`, `reserved`, derived `available`), order-lifecycle stock effects, ledger event model, concurrency strategy, reservation representation, returns/restock rules, Redis non-authority, and Orders↔Inventory module contracts before schema work.

Acceptance criteria: Locked V1 decisions are recorded in [ADR 0012](adr/0012-inventory-quantity-ledger-concurrency.md) and [instructions/inventory.md](../instructions/inventory.md); unresolved future decisions remain explicit; no Inventory schema or APIs are implemented in this task.

Delivered: Accepted ADR 0012; durable Inventory policy; roadmap split into INV-01B for persistence primitives. Physical decrement at `SHIPPED`, reserve at order create, no V1 reservation TTL, no V1 partial fulfillment, and inspected sellable returns only are approved.

Explicitly out of scope: Prisma schema, migrations, Inventory HTTP, Orders integration, Redis stock state, and workers.

### INV-01B — Inventory schema, reservation, ledger, and persistence primitives

Status: DONE | Depends on: CAT-03, INV-01A | Primary: Codex | Review: Claude/Cursor concurrency review, Human migration review

Scope: Add Inventory, InventoryReservation, and InventoryLedger schema with CHECKs/indexes, Product Inventory-row creation/backfill strategy, repositories/persistence, atomic conditional SQL primitives, and PostgreSQL integration/concurrency foundation.

Acceptance criteria: Database constraints enforce non-negative valid state and `reserved <= onHand`; ledger/state consistency and integer quantities follow ADR 0012; PostgreSQL is authoritative; foundation tests cover constraints and conditional updates without HTTP or Orders.

Explicitly out of scope: Admin/public Inventory HTTP, Orders integration, Redis-owned stock, and workers.

Delivered: `Inventory` (`productId` PK, int4 `onHand`/`reserved`, CHECKs, Product FK RESTRICT), `InventoryReservation` (opaque `orderId`, UNIQUE(orderId,productId), ACTIVE/RELEASED/SHIPPED), append-only `InventoryLedger` with partial unique order-lifecycle idempotency; Product 0/0 backfill and create-time `ensureForProduct` in one transaction; atomic tagged-SQL reserve/release/ship/adjust/receive/return/write-off; inventory-row `FOR UPDATE` before reservation writes; opaque `TransactionContext`; no Inventory HTTP. Live `TEST_DATABASE_URL` concurrency run is environment-dependent.

### INV-02 — Stock receiving and adjustments

Status: DONE | Depends on: INV-01B, AUTH-08 | Primary: Codex | Review: Claude/Cursor

Scope: Implement transactional receiving and authorized adjustment application services with reason and actor metadata.

Acceptance criteria: State and ledger change atomically; invalid/overflowing adjustments fail safely; idempotency expectations and audit integration are explicit and tested.

Explicitly out of scope: Reservations and order transitions.

Delivered: Admin `POST /api/v1/admin/inventory/:productId/receive` and `/adjust` (signed delta + required reason) with UUID `Idempotency-Key` replay/conflict via `InventoryCommandIdempotency`; `GET /api/v1/admin/inventory/:productId`; `AdminInventoryOperationsService` orchestrating atomic balance+ledger+idempotency in one PostgreSQL transaction; `INVENTORY_READ` / `INVENTORY_ADJUST`; Persian displayable errors; unit/e2e/integration coverage. No write-off HTTP, reservation orchestration, or inventory list (INV-06). Live `TEST_DATABASE_URL` concurrency run is environment-dependent.

### INV-03 — Reservation and release semantics

Status: DONE | Depends on: INV-01B | Primary: Codex | Review: Claude/Cursor concurrency review

Scope: Implement atomic reservation and release contracts using conditional PostgreSQL updates and deterministic resource ordering for multi-SKU operations.

Acceptance criteria: Overselling and negative reservations are prevented under concurrency; retries/duplicate release behavior and transaction boundaries are tested against PostgreSQL; behavior matches ADR 0012 (reserve at create; release before ship).

Explicitly out of scope: Shipping/commit implementation (INV-04) and Orders HTTP.

Delivered: Internal `reserveForOrder` / `releaseForOrder` application contracts (no HTTP) with collapsed multi-SKU lines, all-or-nothing shortage collection, deterministic Inventory `FOR UPDATE` after an order-scoped PostgreSQL advisory lock, `orderId` idempotency (identical replay / mismatched, partial, or terminal conflict), joinable opaque `TransactionContext`, and `releaseForOrder` ACTIVE→RELEASED with all-RELEASED replay. Unit coverage plus a PostgreSQL reservation suite (including disjoint same-order SKU race, reverse-input deadlock, outer-tx rollback). Live `TEST_DATABASE_URL` concurrency run is environment-dependent.

### INV-04 — Fulfillment and physical stock commitment contract

Status: DONE | Depends on: INV-01B, INV-03 | Primary: Codex | Review: Claude/Cursor concurrency review

Scope: Implement the approved ship/commit contract: on `SHIPPED`, `onHand -= qty` and `reserved -= qty`, with ledger effects, repeat-call idempotency, and atomic conditional updates.

Acceptance criteria: Ship follows ADR 0012; failure/reversal and idempotent repeat calls are testable against PostgreSQL; deterministic locking behavior is covered.

Explicitly out of scope: Re-deciding the physical decrement point; inventing `PACKED`/`PICKED` without a new architecture decision.

Delivered: Internal `shipForOrder({ orderId, actor }, tx?)` application contract (no HTTP) shipping the full ACTIVE reservation set with `onHand -= qty`, `reserved -= qty`, `ACTIVE → SHIPPED`, and `SHIP` ledger in one PostgreSQL transaction; order-scoped advisory serialization; all-or-nothing multi-SKU; all-`SHIPPED` idempotent replay; ship vs release winner semantics; joinable opaque `TransactionContext`; available unchanged when shipping reserved stock. Unit coverage plus a PostgreSQL ship suite (including 20-way same-order stampede, ship vs release/adjust/reserve, outer-tx rollback, partial-failure rollback). Live `TEST_DATABASE_URL` concurrency run is environment-dependent.

### INV-05 — Inventory reconciliation

Status: DONE | Depends on: INV-02, INV-03, INV-04 | Primary: Codex | Review: Claude/Cursor, Human operations review

Scope: Implement safe discrepancy detection between current balances, reservations, and ledger history, with an approved correction workflow.

Acceptance criteria: Reconciliation is repeatable, observable, and cannot silently rewrite history; corrections require reason/actor and produce ledger/audit evidence.

Explicitly out of scope: Automatic destructive repair and analytics snapshots.

Delivered: Internal read-only `InventoryReconciliationService.reconcileProduct(productId)` comparing aggregate balances, ACTIVE reservation totals, and append-only ledger reconstruction/lifecycle checks with stable issue codes; PostgreSQL **REPEATABLE READ** snapshot reads via `TransactionRunner.runSnapshotRead` (no row-level write locks over history); observability events `inventory.reconciliation.completed` / `inventory.reconciliation.inconsistent`; no HTTP (Admin reconciliation endpoint deferred to INV-06); no auto-repair. Unit coverage plus PostgreSQL integration suite (including corruption detection, missing lifecycle events, large ledger history, and concurrent-mutation snapshot proof). Live `TEST_DATABASE_URL` run is environment-dependent.

### INV-06 — Admin inventory APIs and verification suite

Status: DONE | Depends on: INV-02, INV-03, INV-05, AUTH-08 | Primary: Codex | Review: Claude/Cursor concurrency/security review

Scope: Add admin balances, ledger, receiving, adjustment, reservation diagnostics, and reconciliation APIs plus real integration/concurrency coverage.

Acceptance criteria: Permissions and structured errors are explicit; concurrent receive/reserve/release/commit scenarios preserve invariants; query indexes and OpenAPI are verified.

Explicitly out of scope: Customer inventory mutation and Redis caching.

Delivered: Admin `GET /api/v1/admin/inventory` (paginated list with Product join, search, filters, sort allowlist), `GET .../:productId/ledger`, `GET .../:productId/reservations`, `GET .../:productId/reconciliation` (HTTP 200 on inconsistency; no repair), existing balance/receive/adjust from INV-02; `AdminInventoryQueryService` and read repository methods; `INVENTORY_READ` gating; unit/e2e/integration coverage including reconciliation snapshot concurrency via `reconcileProduct()`. No Redis, no ledger mutation HTTP, no automatic repair. Live `TEST_DATABASE_URL` run is environment-dependent.

## Phase 4 — Orders

### ORD-01 — Order schema and historical snapshots

Status: DONE | Depends on: AUTH-07, CAT-03, INV-01B | Primary: Codex | Review: Claude/Cursor, Human migration review

Scope: Model orders/items and immutable shipping/address, product title, unit price, and discount snapshots independently from mutable catalog/profile data.

Acceptance criteria: Money uses integer Toman; required history survives source edits/deletion; constraints/indexes and migration/backfill requirements are reviewed.

Explicitly out of scope: State transitions, reservation, and payment integration.

Delivered: Prisma `Order` / `OrderLine` with `OrderStatus` enum; immutable product/phone/region snapshots; int4 `unitPrice` and BIGINT persisted `lineTotal`/`subtotal`/`total`; server-computed money helpers; `UNIQUE(orderId, productId)`; optional `idempotencyKey` with `UNIQUE(userId, idempotencyKey)`; DB CHECKs including `lineTotal = unitPrice × quantity` and E.164 `customerPhone`; `OrderRepository` (`createWithLines`, `findById`, `findOwnedById`); ADR 0013; `instructions/orders.md`. No HTTP, payment models, or Inventory orchestration. Address/profile/discount snapshots deferred (MIG-01 / profile / PRC). PostgreSQL integration specs exist; live `TEST_DATABASE_URL` run not executed in this environment.

### ORD-02A — Order state machine and authorization matrix

Status: DONE | Depends on: ORD-01, INV-04 | Primary: Human + ChatGPT architecture process | Review: Claude/Cursor, Human approval

Scope: Approve states, allowed transitions, actors, preconditions, cancellation/return boundaries, timestamps, terminal states, concurrency strategy, Orders↔Inventory transaction orchestration, and error model. Inventory quantity effects must follow ADR 0012 / `instructions/inventory.md` rather than inventing alternate stock semantics.

Acceptance criteria: Locked V1 decisions recorded in ADR 0014 and `instructions/orders.md`; unresolved future decisions remain explicit; no transition runtime or HTTP is implemented in this task.

Delivered: Accepted ADR 0014; durable Orders transition policy in `instructions/orders.md`; authorization notes for coarse `ORDER_TRANSITION`, ownership-based customer cancel, and WAREHOUSE read-only Orders access in `instructions/authorization.md`. V1 graph, conditional UPDATE concurrency, idempotent replay, canonical cross-domain lock order, customer BOLA 404 behavior, `deliveryAt` semantics, inactive-entity rules, and `RETURNED` deferred to ORD-07 are approved.

Explicitly out of scope: Transition runtime, Prisma schema changes, HTTP endpoints, re-deciding ADR 0012 inventory effects, payment state, and ORD-07 return implementation.

### ORD-02 — Order transition domain and Inventory orchestration

Status: DONE | Depends on: ORD-01, ORD-02A, INV-04 | Primary: Codex | Review: Claude/Cursor concurrency review

Scope: Implement domain transition commands (confirm, cancel, ship, deliver) with conditional status UPDATE, lifecycle timestamps, cancellation reason validation, idempotent replay, stable Order error codes, and Orders-owned PostgreSQL transactions that orchestrate Inventory contracts per ADR 0014.

Acceptance criteria: Invalid transitions return stable errors; inventory-affecting transitions call Inventory-owned contracts inside the canonical lock order; concurrent competing transitions have exactly one winner; replay does not rewrite timestamps or repeat Inventory side effects; customer cancel maps Inventory failures to `ORDER_INVALID_TRANSITION`; unit and PostgreSQL integration/concurrency tests cover hot paths.

Explicitly out of scope: HTTP endpoints (ORD-05/ORD-06), order creation (ORD-03), `DELIVERED → RETURNED` (ORD-07), payment, and generic status PATCH.

Delivered: Internal `OrderTransitionService` commands `confirmOrder`, `cancelPendingOrderByCustomer`, `cancelOrderByAdmin`, `shipOrder`, `deliverOrder` (no HTTP/OpenAPI). Canonical graph in `order-transitions.ts` without a `RETURNED` runtime edge. Closed repository primitives (`transitionPendingToConfirmed`, `transitionPendingToCancelled`, `transitionPendingToCancelledForOwner`, `transitionConfirmedToCancelled`, `transitionConfirmedToShipped`, `transitionShippedToDelivered`) using `UPDATE ... WHERE status = expectedFrom RETURNING`. Zero-row re-read classification (replay / `ORDER_INVALID_TRANSITION` / `ORDER_NOT_FOUND`). Idempotent replay preserves lifecycle timestamps, `deliveryAt`, and `cancelReason` and skips Inventory. Cancel/ship run in one Orders-owned PostgreSQL transaction: Order row wins first, then `releaseForOrder` / `shipForOrder` join the same opaque `TransactionContext`. Customer cancel maps `INVENTORY_RESERVATION_NOT_FOUND` / `INVENTORY_RESERVATION_CONFLICT` to `ORDER_INVALID_TRANSITION`. Unit coverage plus a PostgreSQL integration/concurrency suite. Live `TEST_DATABASE_URL` run is environment-dependent (not executed here). No schema/migration change.

### ORD-03 — Transactional order creation and idempotency

Status: DONE | Depends on: ORD-01, ORD-02A, INV-03, PRC-05 | Primary: Codex | Review: Claude/Cursor concurrency review

Scope: Implement multi-item order creation, price/discount snapshots, idempotency keys, and inventory reservation through module-owned contracts in one controlled transaction.

Acceptance criteria: Duplicate requests yield one logical order; SKU locks use deterministic ordering; partial reservation/order creation cannot persist; concurrency tests cover hot inventory.

Explicitly out of scope: Asynchronous side effects and payment collection. Customer create/list/detail HTTP (ORD-03A/ORD-04), Admin HTTP (ORD-06), returns, and payments.

Delivered: `OrderCreationService.createOrder` (no HTTP) in one REPEATABLE READ transaction — create idempotency advisory lock, PRC-05 `priceOrderLines`, trusted snapshot persistence (`createWithTrustedSnapshots`), `reserveForOrder`; bounded retry on RR serialization failures; inactive User/Region rejected; Order/OrderLine migration for discounted money + applied-discount evidence + `pricingEvaluatedAt` + payload hash; unit + PostgreSQL integration/concurrency specs (live `TEST_DATABASE_URL` run environment-dependent). Security/concurrency/migration reviews recorded in task handoff.

Checkpoint finding (2026-08-24): the actual service passes the outer transaction to Pricing, Order persistence, and Inventory, but its User and Region repository reads currently use their default clients. Preserve ORD-03 history; ORD-03A must close this authoritative-read transaction-context gap before exposing customer create HTTP.

### ORD-03A — Customer order-create HTTP contract

Status: DONE | Depends on: ORD-03, COM-03, DLU-02, AUTH-08 | Primary: Codex | Review: Claude/Cursor security/concurrency review

Scope: Close the current User/Region transaction-context gap, then bind the approved transactional create service to a customer Order-create endpoint with strict DTOs, principal-derived ownership, UUID idempotency key, commerce-policy/lifetime-discount enforcement, stable errors, OpenAPI, and e2e coverage. This closes the pre-existing ORD-03 HTTP-create gap without overloading the read-only ORD-04 task.

Acceptance criteria: User, Region, Product, Discount, Commerce policy, Order, discount usage, and Inventory work share the approved outer transaction/snapshot where required; clients cannot submit authoritative price/snapshot/owner fields; retries map to ORD-03 replay/conflict; COM-03/DLU-02 cannot be bypassed; Inventory/policy/discount errors follow the approved structured contract; cookie-authenticated mutation security follows the shared CSRF production blocker.

Explicitly out of scope: Order list/detail (ORD-04), cancellation/transitions, policy or discount-usage persistence, and frontend behavior.

Delivered: `POST /api/v1/orders` (`Orders_create`) with `AccessTokenGuard` + `requireCustomerOwnerId` (USER only; Admin → `AUTH_FORBIDDEN`); body `{ regionId, lines }` only; required UUID `Idempotency-Key`; principal-bound USER actor; `201` create / `200` replay; `Cache-Control: no-store`; User/Region reads join ORD-03 RR `TransactionContext`; OpenAPI + unit/e2e/PostgreSQL coverage. CSRF remains the shared production blocker (documented, not implemented). No schema migration.

### ORD-04 — Customer order list and detail

Status: PLANNED | Depends on: ORD-03, AUTH-08 | Primary: Codex | Review: Claude/Cursor

Scope: Implement owner-scoped customer order list/detail APIs using historical snapshots and standardized list behavior.

Acceptance criteria: Cross-user access is denied without existence leakage; pagination/filtering and response DTOs are stable, documented, and tested.

Explicitly out of scope: Mutation and admin fields.

### ORD-05 — Customer cancellation and stock release

Status: PLANNED | Depends on: ORD-02, ORD-03, DLU-02 | Primary: Codex | Review: Claude/Cursor concurrency review

Scope: Implement authorized idempotent cancellation for approved states, release Inventory reservations through its application contract, and release lifetime discounted-quantity consumption per ADR 0017 in the same transaction.

Acceptance criteria: Order transition, discount-usage release, and Inventory release are atomic; repeated/concurrent cancellation is safe; prohibited states return stable errors and audit evidence; shipped Orders do not restore discount entitlement.

Explicitly out of scope: Returns and refunds.

### ORD-06 — Admin order list, detail, and transitions

Status: PLANNED | Depends on: ORD-02, ORD-03, AUTH-08 | Primary: Codex | Review: Claude/Cursor

Scope: Implement permissioned admin queries and single-order transitions with transition preconditions and inventory integration.

Acceptance criteria: Filters/sorts are allowlisted and indexed; transition conflicts are explicit; actor/request/correlation data reaches audit hooks.

Explicitly out of scope: Bulk operations, dispatch board, and returns.

### ORD-07 — Returns, bulk transitions, and dispatch board

Status: PLANNED | Depends on: ORD-05, ORD-06, DLU-02 | Primary: Codex after Human business approval | Review: Claude/Cursor concurrency review, Human approval

Scope: Implement separately approved return semantics, bounded bulk transition behavior, and dispatch-board queries without bypassing the order state machine.

Acceptance criteria: Partial/batch failure semantics and authorization are explicit; every item is transition-validated; inventory/reversal behavior follows approved contracts; returns do **not** restore lifetime discount entitlement in V1 (ADR 0017).

Explicitly out of scope: Inventing refund, carrier, or physical-return rules; inventing discount-entitlement restoration.

### ORD-08 — Order audit, concurrency, and load verification

Status: PLANNED | Depends on: ORD-03, ORD-05, ORD-06, COM-03, DLU-02, SET-02, AUD-01 | Primary: Codex | Review: Claude/Cursor concurrency/performance review

Scope: Complete order audit events, race-condition suites, idempotency verification, query analysis, and representative create/list/transition load tests.

Acceptance criteria: Duplicate creation, hot-SKU reservation, cancel/transition races, and normal/spike behavior have measurable assertions with no invariant loss.

Explicitly out of scope: Changing business rules to meet performance targets.

## Phase 4A — Commerce Order-Acceptance Policy

### COM-01 — Commerce order-acceptance policy decisions

Status: DONE | Depends on: ORD-03, AUTH-08 | Primary: Human + ChatGPT architecture process | Review: Claude/Cursor concurrency/security review, Human approval

Scope: Accept or revise the typed Commerce Settings recommendation in `instructions/commerce-policy.md` for configurable ordering hours and minimum summed cart quantity, including Order-creation placement, lock order, validation, security, and cache non-authority.

Acceptance criteria: Approved decisions are recorded in an ADR and durable instruction policy; the model is typed rather than generic JSON; only new logical Order acceptance is affected; PostgreSQL transaction/clock semantics and migration defaults are unambiguous; no implementation is performed in this task.

Delivered: accepted [ADR 0016](adr/0016-commerce-order-acceptance-policy.md) and durable [Commerce policy](../instructions/commerce-policy.md): immutable `Asia/Tehran` business timezone; minute-precision half-open regular/special windows with cross-midnight support; `CLOSED` / `SPECIAL_HOURS` date overrides unique per local date; fail-closed absent/invalid settings with explicit first Admin creation; normalized summed minimum quantity; one policy-wide monotonic revision; optimistic Admin mutation serialization; lock-free REPEATABLE READ Order snapshot evaluation; minimal Order revision/time evidence; `COMMERCE_POLICY_MANAGE` for `SUPER_ADMIN` only; stable error/status/message taxonomy; public-read minimization and audit candidates. No schema, migration, API, source, controller, or test implementation.

Explicitly out of scope: Prisma/schema/API/application/test changes, discount usage limits, settlement, and frontend rendering.

### COM-02 — Typed Commerce Settings persistence and Admin API

Status: DONE | Depends on: COM-01, AUTH-08 | Primary: Codex | Review: Claude/Cursor security/concurrency review, Human migration review

Scope: Implement the accepted typed Commerce Settings and `CommerceScheduleOverride` models, explicit first-settings creation plus validated Admin read/update/override APIs, `SUPER_ADMIN`-only `COMMERCE_POLICY_MANAGE` permission through central RBAC, global revision/concurrency behavior, database constraints, OpenAPI, audit hooks, and PostgreSQL tests.

Acceptance criteria: No generic key-value/JSON settings store exists; `CLOSED` / `SPECIAL_HOURS` shape and unique Tehran local dates are constrained; missing/invalid configuration follows COM-01; unauthorized Admins cannot read or mutate Admin policy; concurrent settings/override updates deterministically compare and increment one revision; migration leaves the singleton absent rather than inventing business values.

Delivered: Typed `CommerceSettings` singleton and unique `CommerceScheduleOverride` PostgreSQL models with minute-of-day and `date` persistence, shape/range/singleton/FK constraints, explicit absent-state initialization (`expectedRevision=0` → revision `1`), actor metadata, lock-serialized compare/increment transactions across settings and override create/update/remove, bounded override management reads, strict Admin DTOs and stable errors, safe structured mutation events, `COMMERCE_POLICY_MANAGE` granted only to `SUPER_ADMIN`, OpenAPI, unit/E2E/real-PostgreSQL concurrency and rollback coverage. No Order evaluation, public policy read, Redis authority, or AuditLog persistence.

Explicitly out of scope: Order-create enforcement, Redis-authoritative caching, discount usage, settlement, and unrelated operational settings.

### COM-03 — Transactional Order acceptance enforcement

Status: DONE | Depends on: COM-02, ORD-03 | Primary: Codex | Review: Claude/Cursor concurrency/security review

Scope: Integrate regular/date-override ordering availability and minimum-total-quantity evaluation into `OrderCreationService` after idempotency replay/conflict detection and before User/Region reads, pricing, persistence, or reservation, inside the existing REPEATABLE READ snapshot without pessimistic policy row locks.

Acceptance criteria: Closed hours and below-minimum carts return distinct stable displayable errors; replays do not re-evaluate current policy; settings/current-date/preceding-date override reads share one committed snapshot and persist revision/time evidence; concurrent configuration changes cannot produce a hybrid policy; failures persist no Order/reservation/usage; frontend checks remain non-authoritative; unit and real-PostgreSQL boundary/concurrency tests cover midnight, equality, override precedence/carry/truncation, policy updates, and retries.

Delivered: `CommercePolicyService.evaluateOrderAcceptance` joins ORD-03 create after idempotency and before User/Region/pricing/persist/reserve; Asia/Tehran minute half-open regular/SPECIAL_HOURS + CLOSED + prior-date cross-midnight tails; normalized summed minimum; fail-closed absent/invalid policy; one DB `CURRENT_TIMESTAMP` evaluation instant shared with PRC-05; additive nullable `Order.commercePolicyRevision`; stable `ORDERING_POLICY_UNAVAILABLE` / `ORDERING_CLOSED` / `ORDER_MINIMUM_QUANTITY_NOT_MET`; policy rejection leaves no Order/Inventory/idempotency residue; unit + PostgreSQL RR snapshot/concurrency specs. ORD-03A User/Region tx gap preserved. No customer HTTP, public policy read, or Redis authority.

Explicitly out of scope: Customer HTTP binding (ORD-03A), Inventory availability semantics, Redis locks/cache authority, and discount lifetime usage.

## Phase 5 — Pricing & Discounts

### PRC-01 — Pricing rules and price history

Status: DONE | Depends on: CAT-03 | Primary: Human + ChatGPT architecture process, then Codex | Review: Claude/Cursor, Human approval

Scope: Approve price-change semantics and implement immutable product price history with integer-Toman constraints and effective timestamps.

Acceptance criteria: Current price and history cannot diverge silently; actor/reason and timezone semantics are explicit; admin changes are transactional and tested.

Explicitly out of scope: Discounts and analytics materialization.

### PRC-02 — Discount model and activation lifecycle

Status: DONE | Depends on: CAT-03 | Primary: Codex after Human business approval | Review: Claude/Cursor, Human migration review

Scope: Model `PERCENT` and `FIXED` discounts, targets, activation windows, status/lifecycle, and precedence inputs supported by confirmed requirements.

Acceptance criteria: Invalid amounts/windows/combinations are constrained; timezone and overlap rules are approved; no usage limit or eligibility dimension is invented.

Delivered: Prisma `Discount` with `DiscountType` (`PERCENT`/`FIXED`) and `DiscountTarget` (`ORDER`/`PRODUCT`/`CATEGORY`); integer `percentValue` (1–100) and `fixedAmount` (Toman) with mutual-exclusion CHECKs; optional UTC `startsAt`/`endsAt` window CHECK; explicit `isActive` lifecycle; opaque `precedence` input; `ON DELETE RESTRICT` on Product/Category; `PricingModule` / `DiscountService` with server-side validation and activate/deactivate; no HTTP, calculation, promo codes, or Order snapshots; `instructions/pricing.md` discount section; unit + PostgreSQL integration coverage.

Explicitly out of scope: Calculation, redemption counters, and promo presentation.

### PRC-03 — Pricing and discount calculation

Status: DONE | Depends on: PRC-01, PRC-02 | Primary: Codex | Review: Claude/Cursor

Scope: Implement deterministic calculation for approved percent/fixed behavior, rounding, precedence, activation, and any evidenced eligibility/limit rules.

Acceptance criteria: Pure rule tests cover boundaries and integer-Toman results; concurrent usage is safe if and only if approved usage limits exist; stable identifiers support order snapshots.

Delivered: Pure domain `calculateDiscount` in `discount-calculation.ts` with PERCENT/FIXED amounts, LINE (`PRODUCT`/`CATEGORY`) and ORDER scopes, server-authoritative targeting, UTC window eligibility, V1 single-winner stacking, higher-`precedence` winner with ascending-`id` tie-break, floor percent rounding, fixed cap at base, bigint-safe bounds, malformed-row skip, persistence-neutral result model for future Order snapshots; `instructions/pricing.md` calculation section; comprehensive unit tests. No HTTP, DB mutation, promo codes, usage limits, or Redis.

Explicitly out of scope: Assuming coupons, per-user limits, stacking, or rewards without requirements.

### PRC-04 — Admin pricing, discount, and promo-banner APIs

Status: DONE | Depends on: PRC-01, PRC-02, AUTH-08, CAT-04 | Primary: Codex | Review: Claude/Cursor

Scope: Implement authorized price changes and discount lifecycle APIs, plus an explicit promo-banner relationship to media/content where legacy behavior requires it.

Delivered: Admin pricing routes (`GET .../price-history`, `PATCH .../price`) with `DISCOUNT_READ`/`DISCOUNT_MANAGE`; Admin discount CRUD/list with activate/deactivate lifecycle, CAT-01 list/search/filter/sort, strict DTO validation, stable errors, OpenAPI, and e2e coverage. Promo-banner API deferred — no evidenced legacy requirements in-repo.

Acceptance criteria: Validation, conflicts, audit hooks, list contracts, OpenAPI, and integration tests cover lifecycle transitions and historical preservation.

Explicitly out of scope: Public catalog calculation and order creation.

### PRC-05 — Public pricing and order snapshot integration

Status: DONE | Depends on: PRC-03, CAT-06, ORD-01 | Primary: Codex | Review: Claude/Cursor concurrency review

Scope: Expose calculated public pricing and provide the Order-owned creation flow with immutable calculation evidence/snapshot inputs.

Acceptance criteria: Displayed and ordered pricing share approved rules; changes during concurrent checkout cannot mutate persisted order history; eligibility ownership is enforced.

Delivered: Persistence-neutral `OrderPricingService.priceOrderLines` composing PRC-03 LINE then ORDER on the discounted subtotal ([ADR 0015](adr/0015-line-then-order-discount-composition.md)); server-authoritative Product price/name/category with CAT-06 sale visibility; one shared `evaluatedAt`; batch Product/Discount reads (no N+1); REPEATABLE READ snapshot reads with joinable `TransactionContext` for ORD-03; explicit line/order snapshot fields including applied-discount evidence; no Order schema migration (ORD-03 owns persistence); unit + PostgreSQL concurrency/consistency specs; `instructions/pricing.md` / `orders.md` updates.

Explicitly out of scope: Payment settlement, Order HTTP/create, promo codes, usage limits, cache authority, and Order/OrderLine discount column migration.

### DLU-01 — Product-discount lifetime-limit decisions

Status: DONE | Depends on: PRC-05, ORD-03 | Primary: Human + ChatGPT architecture process | Review: Claude/Cursor concurrency/financial-rule review, Human approval

Scope: Approve the complete lifecycle and concurrency contract for optional per-customer lifetime quantity caps on PRODUCT discounts only, including over-limit behavior, consumption/release, returns, snapshot evidence, idempotency, and PostgreSQL usage persistence shape. No implementation.

Acceptance criteria: No `SUM(OrderLine)` read-check-write or Redis authority; consumption/release events reconcile with Order lifecycle; existing null caps remain unlimited; lock order and invariant are explicit; no implementation is performed in this task.

Explicitly out of scope: CATEGORY/ORDER discount caps, per-day/per-order limits, promo codes, rewards, and implementation.

Delivered: Accepted [ADR 0017](adr/0017-discount-lifetime-quantity-limit.md); durable policy in `instructions/pricing.md` and `instructions/orders.md`. V1 accepts **partial discount** (not reject, not whole-line no-discount). Caps are PRODUCT LINE only; CATEGORY/ORDER remain uncapped. Consume on Order create with pricing+reserve; release on pre-`SHIPPED` cancel with Inventory release; no restore after `SHIPPED` or on return. Persistence direction: `DiscountCustomerUsage` aggregate + append-only `DiscountUsageRecord`; OrderLine `discountedQuantity` snapshot evidence; sorted `discountId` locks before Inventory. Idempotent create/cancel must not double-consume/release.

### DLU-02 — Atomic discount usage and pricing integration

Status: DONE | Depends on: DLU-01, PRC-04, ORD-03 | Primary: Codex | Review: Claude/Cursor concurrency/financial-rule review, Human migration review

Scope: Add the approved optional PRODUCT-discount `maxQuantityPerCustomer`, PostgreSQL `DiscountCustomerUsage` aggregate + append-only `DiscountUsageRecord` persistence, Admin DTO/API support, deterministic usage locking, PRC-05 partial-quantity calculation integration, ORD-03 atomic consume behavior, ORD-05 release wiring, idempotency, and immutable OrderLine `discountedQuantity` snapshot evidence.

Acceptance criteria: Concurrent Orders for one User/Discount cannot exceed the cap; replay consumes once; pre-ship cancellation releases matching DLU-01; returns do not restore entitlement; unlimited existing discounts remain unchanged; usage and Order/reservation commit or roll back together; real PostgreSQL races and OpenAPI/error contracts are verified.

Explicitly out of scope: Redis counters/locks, CATEGORY/ORDER quantity caps, unrelated discount stacking changes, generic promotion engines, customer-visible usage-history APIs, and ORD-07 entitlement restoration.

Delivered: Additive migration for `Discount.maxQuantityPerCustomer` (PRODUCT-only CHECK), `DiscountCustomerUsage`, append-only `DiscountUsageRecord` (CONSUME/RELEASE uniqueness), and `OrderLine.discountedQuantity` with historical backfill; Admin create/update/response DTO field; PRC-05 partial-base LINE math + lifetime eligibility (exhausted capped PRODUCT not LINE-eligible); ORD-03 sorted `discountId` FOR UPDATE locks → price → persist → CONSUME → Inventory reserve in one RR transaction; pre-SHIPPED cancel RELEASE before Inventory release; idempotent create/cancel via usage-record uniqueness; unit + real-PostgreSQL concurrency/integration suite (`discount-lifetime-usage.integration-spec.ts`).

## Phase 5A — Deferred Settlement

### SET-01 — Deferred-settlement lifecycle decisions

Status: BLOCKED | Depends on: ORD-02A, CAT-04, AUTH-08 | Primary: Human + ChatGPT architecture process | Review: Claude/Cursor security/operations review, Human approval

Blocker / decision owner: Product and operations owner must decide one versus multiple receipts, receipt-required/auto-settle versus explicit confirmation, correction/reopen/detach behavior, exact Admin role grants, and stable conflict/error semantics.

Scope: Accept or revise the separate Settlement aggregate recommendation in `instructions/settlement.md`, preserving the no-payment-gateway and Order-state separation decisions while defining due-date, receipt, settlement, overdue, audit, Media, timezone, and authorization semantics.

Acceptance criteria: Lifecycle and correction rules are explicit; `dueAt` is allowed only after `DELIVERED`; overdue is derived; Media deletion is restricted; no provider/card/bank/accounting fields exist; no implementation is performed in this task.

Explicitly out of scope: Online payment processing, accounting, refunds, customer credit flags, implementation, and unapproved reminders.

### SET-02 — Deferred-settlement persistence and Admin operations

Status: PLANNED | Depends on: SET-01, ORD-02, CAT-04, AUTH-08 | Primary: Codex | Review: Claude/Cursor security/concurrency review, Human migration review

Scope: Implement the accepted Settlement aggregate, receipt Media reference(s), explicit application commands, permissioned Admin detail/list/filter/sort APIs, derived overdue behavior, conditional concurrency/idempotency, audit hooks, OpenAPI, and real PostgreSQL coverage.

Acceptance criteria: Only delivered Orders receive due dates; settlement state never mutates Order status; arbitrary Media IDs/BOLA are prevented; referenced Media deletion is restricted; receipt/settle retries cannot duplicate or lose evidence; no sensitive payment data is accepted or logged.

Explicitly out of scope: Customer settlement APIs, gateway/provider integration, automated accounting, and reminders/notifications not separately approved.

## Phase 6 — Referrals & Visitors

### REF-01 — Referral attribution and abuse policy

Status: PLANNED | Depends on: AUTH-07 | Primary: Human + ChatGPT architecture process | Review: Claude/Cursor security review, Human approval

Scope: Distinguish attribution from rewards and approve ownership, attribution window/source, duplicate attribution, self-referral, reassignment, visitor-to-user conversion, and abuse policy.

Acceptance criteria: Rules address visitor, user, and store codes/links independently of monetary rewards; unresolved reward policy remains explicitly deferred.

Explicitly out of scope: Inventing reward amounts or assuming last/first-touch behavior.

### REF-02 — Referral and visitor persistence

Status: PLANNED | Depends on: REF-01 | Primary: Codex | Review: Claude/Cursor, Human migration/privacy review

Scope: Model visitor identities where justified, user/store referral codes and links, attribution records, ownership, provenance, and uniqueness/idempotency constraints.

Acceptance criteria: Referral is not coupled only to visitors; duplicate requests cannot create conflicting attribution; raw visitor data is minimized and classified for lifecycle review.

Explicitly out of scope: Rewards, broad tracking, and fingerprinting without privacy approval.

### REF-03 — Referral capture and attribution services

Status: PLANNED | Depends on: REF-02 | Primary: Codex | Review: Claude/Cursor security/concurrency review

Scope: Implement bounded referral-link resolution, attribution capture, registration/store association, ownership enforcement, and duplicate/self-referral handling.

Acceptance criteria: Attribution is idempotent and transactional; invalid/abusive input fails safely; logs and responses avoid unnecessary visitor/customer PII.

Explicitly out of scope: Reward issuance and marketing automation.

### REF-04 — Visitor administration, referred-store views, and optional rewards

Status: PLANNED | Depends on: REF-03, AUTH-08, ASY-01 | Primary: Codex after Human approval | Review: Claude/Cursor, Human privacy/business review

Scope: Add authorized visitor/referral administration and referred-store views; add idempotent reward processing only if a separate reward policy is approved.

Acceptance criteria: Views enforce permissions and data minimization; any reward uses durable idempotency/outbox semantics and cannot self-award or duplicate.

Explicitly out of scope: Defining monetary rewards in this roadmap.

## Phase 7 — Notifications

### NOT-01 — Durable notification inbox model

Status: PLANNED | Depends on: AUTH-07 | Primary: Codex | Review: Claude/Cursor, Human migration review

Scope: Model durable user Notification records, approved notification types, safe payload/versioning, read state, creation source, and timestamps.

Acceptance criteria: The inbox record is authoritative independently of push delivery; ownership/indexes support list and unread count; sensitive snapshots are avoided.

Explicitly out of scope: Push tokens, providers, and queue workers.

### NOT-02 — User notification inbox APIs

Status: PLANNED | Depends on: NOT-01, AUTH-08 | Primary: Codex | Review: Claude/Cursor

Scope: Implement owner-scoped notification list, unread count, mark-one-read, and mark-all-read endpoints.

Acceptance criteria: Read mutations are idempotent and ownership-safe; pagination, concurrent mark/read behavior, structured errors, OpenAPI, and e2e coverage are complete.

Explicitly out of scope: Notification deletion and push delivery.

### NOT-03 — Order-status notification generation

Status: PLANNED | Depends on: NOT-01, ORD-02A, ASY-01 | Primary: Codex | Review: Claude/Cursor concurrency review

Scope: Create durable inbox notifications from approved order transitions in the same transaction/outbox boundary where required.

Acceptance criteria: Duplicate transitions/retries create at most one logical notification per event; content uses safe historical data; generation cannot make order durability depend on Redis.

Explicitly out of scope: Push delivery and unapproved notification types.

### NOT-04 — Delivery abstraction and push installations

Status: PLANNED | Depends on: NOT-01, AUTH-08 | Primary: Human + ChatGPT architecture process, then Codex | Review: Claude/Cursor security/privacy review

Scope: Approve delivery-channel semantics and implement a provider-independent push installation/token abstraction with ownership, revocation, consent, and lifecycle rules.

Acceptance criteria: Notification records remain the inbox source; provider credentials stay outside domain code; stale/invalid tokens can be retired safely.

Explicitly out of scope: Selecting or integrating a push vendor before approval.

### NOT-05 — BullMQ notification delivery worker

Status: PLANNED | Depends on: NOT-03, NOT-04, ASY-02, ASY-03 | Primary: Codex | Review: Claude/Cursor concurrency/operations review

Scope: Implement outbox-backed delivery jobs, provider adapter invocation, retry classification, idempotency, correlation context, failed-job visibility, and replay safety.

Acceptance criteria: At-least-once delivery cannot duplicate logical sends beyond provider guarantees; permanent failures stop retrying; inbox writes remain durable during Redis/provider outage.

Explicitly out of scope: Admin UI and additional delivery channels.

## Phase 8 — Content & Remaining Admin APIs

### CNT-01 — Blog model and public APIs

Status: PLANNED | Depends on: CAT-01, CAT-04 | Primary: Codex | Review: Claude/Cursor, Human migration review

Scope: Model legacy blog/content relationships and implement public published list/detail APIs with explicit slugs, visibility, and publication timestamps.

Acceptance criteria: Draft/unpublished content cannot leak; pagination/search and Tehran/UTC publication semantics are approved; media history is preserved.

Explicitly out of scope: Admin editing and Redis caching.

### CNT-02 — Blog administration and publishing

Status: PLANNED | Depends on: CNT-01, AUTH-08 | Primary: Codex | Review: Claude/Cursor

Scope: Implement authorized create/edit/publish/unpublish workflows with explicit state transitions and media references.

Acceptance criteria: Validation, slug conflicts, scheduling only if evidenced, audit hooks, OpenAPI, and integration/e2e coverage are complete.

Explicitly out of scope: Inventing editorial workflow or scheduled publishing.

### ADM-00 — Admin identity foundation

Status: DONE | Depends on: AUTH-08 | Primary: Codex after Human security approval | Review: Claude/Cursor security review

Scope: Persist the minimum Admin identity required by the authorization architecture: canonical unique email, Argon2id `passwordHash`, code-defined `AdminRole`, `isActive`, and the real `ADMIN_ROLE_RESOLVER` implementation. Settle the architecture-owner decisions that email is the login identifier and that an authenticated wrong subject type answers 403. Document that Admin sessions are deferred to a separate model rather than a nullable polymorphic `AuthSession`.

Acceptance criteria: Admin persistence and migration exist; concurrent same-email creation cannot create two rows; password hashing goes through the shared `PasswordHasher` port; role resolution uses the AUTH-08 catalog with no bare role branching; inactive/missing/unknown admins deny; USER/ADMIN subject separation and wrong-subject 403 are covered by unit and e2e tests; PostgreSQL integration covers uniqueness, concurrent create, role persistence, and disabled-admin denial; no default credentials, no admin HTTP, no ADMIN token issuance, and no automatic bootstrap.

Delivered: `Admin` / `AdminRole` Prisma model and migration, `AdminsModule` (`AdminIdentityService`, `AdminRepository`, `PrismaAdminRoleResolver`), composition-root wiring into `AuthorizationModule.forRoot()`, wrong-subject 403 on `requireCustomerOwnerId` and session logout paths, [ADR 0008](adr/0008-admin-identity.md), and the test suites above. Admin sessions, login HTTP, ADMIN access-token issuance, first-`SUPER_ADMIN` operator provisioning, and admin management APIs remain later work.

Explicitly out of scope: Admin login/session HTTP, admin CRUD/management APIs, default or seeded credentials, automatic first-admin bootstrap, and polymorphic session FKs.

### ADM-AUTH-01 — Admin login, sessions, and secure bootstrap

Status: DONE | Depends on: ADM-00, AUTH-04, AUTH-08 | Primary: Codex after Human security approval | Review: Claude/Cursor security/concurrency review

Scope: Implement Admin password login, dedicated `AdminAuthSession` persistence (no nullable polymorphic `AuthSession.userId`), ADMIN access-token issuance, opaque rotating refresh tokens, namespaced Admin HttpOnly cookies, refresh/logout/logout-all, `GET /admin/auth/me`, timing-safe credential rejection, and an explicit operator-controlled first-`SUPER_ADMIN` provisioning command. Connect authenticated ADMIN principals to the existing `ADMIN_ROLE_RESOLVER`. Do not implement general Admin account management.

Acceptance criteria:

- `POST /api/v1/admin/auth/login` verifies canonical email + password, refuses unknown/wrong credentials with a generic public error, and does not enumerate accounts.
- Successful login persists `AdminAuthSession`, issues an ADMIN access token bound to that session id, sets Admin AT/RT cookies (never JSON tokens), and sets `Cache-Control: no-store`.
- Refresh rotation, reuse detection, family revocation, concurrent refresh safety, logout, and logout-all match User session security semantics without sharing User session rows or consumption records.
- USER tokens on Admin auth routes and ADMIN tokens on customer-only routes return 403, not 401.
- Inactive Admin cannot log in or refresh. Disabling an Admin does not yet auto-revoke sessions (owed by `ADM-01`).
- `pnpm admin:create` never runs automatically, never defaults an omitted role to a privileged role, never prints the password, and never creates known/default credentials.
- No general Admin CRUD HTTP. CSRF remains the shared production blocker for cookie-authenticated browser mutations.

Explicitly out of scope: Admin list/create/update/disable/reset-password HTTP, impersonation, default credentials, automatic startup bootstrap, polymorphic User/Admin sessions, and a separate Admin CSRF mechanism.

### ADM-01 — Admin account management

Status: PLANNED | Depends on: ADM-AUTH-01, AUTH-08 | Primary: Codex after Human security approval | Review: Claude/Cursor security review

Scope: Implement permissioned admin list/detail/create/update/disable flows on top of the ADM-00 identity model and ADM-AUTH-01 sessions. Owes refresh-session revocation on disablement and security-sensitive role changes. Also owes the admin-route guard-attachment architecture test for permissioned admin APIs (auth-lifecycle `/admin/auth/*` allowlist is defined by ADM-AUTH-01).

Acceptance criteria: Privilege escalation and last-critical-admin risks are addressed; credentials are never returned; role changes and disablement revoke Admin refresh sessions as approved and are audited; every registered permissioned admin route carries `AccessTokenGuard`, `PermissionGuard`, and permission metadata.

Explicitly out of scope: Impersonation and autonomous superuser creation. Admin login/session HTTP belongs to ADM-AUTH-01.

### ADM-02 — Store and customer administration

Status: PLANNED | Depends on: AUTH-07, AUTH-08, REF-02 | Primary: Codex | Review: Claude/Cursor privacy/security review

Scope: Implement legacy-compatible store/customer list and detail views with explicit permissions, filters, referral relationships, and data minimization.

Acceptance criteria: Sensitive fields are purpose-limited; N+1/index behavior is reviewed; cross-record ownership and admin scopes are tested and documented.

Explicitly out of scope: Editing identity credentials and defining store business semantics not evidenced by legacy behavior.

### MED-01 — File storage, uploads, and remaining media workflows

Status: PLANNED | Depends on: CAT-04, AUTH-08 | Primary: Codex after Human architecture approval | Review: Claude/Cursor security review

Scope: Remaining media workflows after CAT-04: Product/Blog/Category attachment and detachment, historical-reference rules, and controlled orphan cleanup. CAT-04 already delivered the storage port, validated single/multi upload, Admin list/detail/delete, and the in-memory plus S3-compatible adapters.

Acceptance criteria: Attachment does not assume one-to-one Product↔Media; referenced historical media is not deleted; orphan cleanup ownership is explicit; live storage verification uses a dedicated TEST bucket.

Explicitly out of scope: Selecting unapproved transformations or deleting referenced historical media. Re-implementing CAT-04 upload/list/delete.

## Phase 9 — Transactional Async & Operational Features

### ASY-01 — Transactional outbox schema and publisher contract

Status: PLANNED | Depends on: INF-01 | Primary: Codex | Review: Claude/Cursor concurrency review, Human migration review

Scope: Add a minimal versioned outbox model and application contract that persists business events in the same PostgreSQL transaction as critical state.

Acceptance criteria: Event identity, correlation, type/version, payload restrictions, publish state, indexes, cleanup ownership, and duplicate semantics are explicit and tested.

Explicitly out of scope: Domain-specific events and dispatch workers.

### ASY-02 — Outbox dispatcher

Status: PLANNED | Depends on: ASY-01, FND-07 | Primary: Codex | Review: Claude/Cursor concurrency/operations review

Scope: Implement concurrent-safe claiming, BullMQ publication, acknowledgement, retry/backoff, and crash recovery for pending outbox records.

Acceptance criteria: Multiple dispatchers cannot lose or incorrectly double-complete records; Redis outages preserve PostgreSQL state; real integration tests prove restart behavior.

Explicitly out of scope: Exactly-once claims and business processors.

### ASY-03 — Worker process entrypoint and lifecycle

Status: PLANNED | Depends on: ASY-02 | Primary: Codex | Review: Claude/Cursor architecture/operations review

Scope: Add a non-HTTP worker composition root that loads only required infrastructure/application modules and establishes async correlation context.

Acceptance criteria: API and worker processes share business code without duplicate logic; startup/readiness/shutdown, concurrency, timeouts, and signals are verified.

Explicitly out of scope: Running empty/fake workers and Liara automation.

### ASY-04 — Failed-job inspection, replay, and recovery

Status: PLANNED | Depends on: ASY-02, ASY-03 | Primary: Codex after Human operations approval | Review: Claude/Cursor security/operations review

Scope: Define and implement safe failure inspection, bounded retention, authorized replay, poison-job handling, and operational recovery procedures.

Acceptance criteria: Metadata includes safe queue/job/attempt/correlation/timestamps; replay is idempotent and audited; PII/secrets are absent; critical alerts have owners.

Explicitly out of scope: Admin UI and arbitrary payload editing.

### ASY-05 — Concrete scheduled cleanup and expiration jobs

Status: PLANNED | Depends on: ASY-03, DATA-02 | Primary: Codex after Human policy approval | Review: Claude/Cursor operations review

Scope: Add scheduled jobs only for approved concrete lifecycle cases whose correctness and ownership are documented.

Acceptance criteria: Each schedule has idempotency, overlap prevention, timezone, retry, observability, manual recovery, and real-infrastructure tests.

Explicitly out of scope: Speculative cron jobs or using Redis as the sole durable schedule record.

## Phase 10 — Analytics

### ANL-01 — Analytics contracts and business-time semantics

Status: PLANNED | Depends on: ORD-02A, PRC-01, INV-01B | Primary: Human + ChatGPT architecture process | Review: Claude/Cursor, Human approval

Scope: Define exact metrics, filters, authorization, freshness, source facts, and Tehran/business-day boundaries for product price chart, daily stock, sales overview, top products, and today pulse.

Acceptance criteria: Every metric has an unambiguous formula and timezone boundary; canceled/returned order treatment and stock snapshot meaning are approved.

Explicitly out of scope: Query implementation and introducing an analytics datastore.

### ANL-02 — Product price and daily-stock analytics

Status: PLANNED | Depends on: ANL-01, PRC-01, INV-05 | Primary: Codex | Review: Claude/Cursor query/performance review

Scope: Implement correct PostgreSQL queries/APIs for product price history charts and daily stock using approved historical sources.

Acceptance criteria: Boundary/timezone cases, sparse days, indexes, authorization, OpenAPI, and real-data-scale query plans are tested.

Explicitly out of scope: Redis authority and speculative pre-aggregation.

### ANL-03 — Sales overview, top products, and today pulse

Status: PLANNED | Depends on: ANL-01, ORD-03 | Primary: Codex | Review: Claude/Cursor query/performance review

Scope: Implement the remaining legacy analytics with PostgreSQL aggregation and documented state/time semantics.

Acceptance criteria: Results reconcile to order facts; ties, empty periods, cancellations/returns, pagination/limits, permissions, and time boundaries are tested.

Explicitly out of scope: Elasticsearch, a data warehouse, and predictive analytics.

### ANL-04 — Analytics index and performance verification

Status: PLANNED | Depends on: ANL-02, ANL-03 | Primary: Codex | Review: Claude/Cursor performance review, Human capacity review

Scope: Analyze query plans, add justified indexes or approved aggregation only where measurements demand it, and establish analytics load baselines.

Acceptance criteria: Representative volumes meet approved targets without N+1 behavior; index write costs and freshness tradeoffs are documented.

Explicitly out of scope: Premature analytics databases or unmeasured caching.

## Phase 11 — Audit & Diagnostics

### AUD-01 — AuditLog model and safe event contract

Status: PLANNED | Depends on: AUTH-02, FND-03 | Primary: Codex after Human security/privacy approval | Review: Claude/Cursor, Human migration review

Scope: Model append-oriented audit events with actor, action, entity identity, safe before/after fields when useful, request/correlation IDs, and timestamps.

Acceptance criteria: Sensitive fields are excluded/redacted by construction; action/entity vocabularies and actor-system semantics are stable; indexes support authorized review.

Explicitly out of scope: Logging every read, raw payload capture, and retention periods.

### AUD-02 — Domain audit integration

Status: PLANNED | Depends on: AUD-01, AUTH-08 | Primary: Codex | Review: Claude/Cursor architecture/security review

Scope: Provide an application-level audit writer and integrate approved security and mutation events without modules writing another module's tables directly.

Acceptance criteria: Audit creation follows transaction/durability decisions per event; failures are observable; tests prove actor/request/correlation propagation and redaction.

Explicitly out of scope: Retrofitting unimplemented domains and external SIEM delivery.

### AUD-03 — Admin audit access

Status: PLANNED | Depends on: AUD-02 | Primary: Codex | Review: Claude/Cursor privacy/security review

Scope: Implement tightly permissioned audit list/detail search with allowlisted filters and safe output DTOs.

Acceptance criteria: Sensitive before/after data cannot leak; access itself is auditable; pagination/index/query plans and OpenAPI are verified.

Explicitly out of scope: Audit mutation/deletion and broad export without approval.

### AUD-04 — Safe diagnostic bundle

Status: PLANNED | Depends on: FND-03, AUD-02, DEP-04 | Primary: Codex after Human security approval | Review: Claude/Cursor security review

Scope: Implement an authorized diagnostic bundle containing only approved request/correlation IDs, safe error code, operation/timestamp, version, and Git SHA.

Acceptance criteria: Automated tests prove no PII, secrets, bodies, credentials, or infrastructure connection details are present; access and generation are audited.

Explicitly out of scope: General debug dumps and an Admin UI.

## Phase 12 — Performance & Reliability

### REL-01 — Real PostgreSQL and Redis test environments

Status: PLANNED | Depends on: FND-07, INF-01 | Primary: Codex | Review: Claude/Cursor, Human infrastructure review

Scope: Provision CI/staging-compatible disposable PostgreSQL and Redis integration targets with isolation, cleanup, secrets, and explicit opt-in local remote use.

Acceptance criteria: Tests prove real service contact and fail when unavailable; production endpoints are rejected; heavy suites do not require laptop Docker.

Explicitly out of scope: Production provisioning.

### REL-02 — Inventory and idempotency concurrency suites

Status: PLANNED | Depends on: REL-01, INV-06, ORD-03, COM-03, DLU-02, SET-02 | Primary: Codex | Review: Claude/Cursor concurrency review

Scope: Build repeatable real-PostgreSQL races for inventory invariants, deterministic locking, order idempotency, commerce-policy updates, discount usage, settlement commands, duplicate cancellation, and retry behavior.

Acceptance criteria: Tests assert durable final state/ledger/history rather than only HTTP status and detect oversell, duplicate orders, deadlocks, or double release.

Explicitly out of scope: Mocked concurrency claims.

### REL-03 — k6 baseline and scenario harness

Status: PLANNED | Depends on: ORD-04, CAT-06, ANL-03 | Primary: Codex after dependency review | Review: Claude/Cursor performance review

Scope: Add the approved k6/equivalent harness, representative fixtures, environment safety guards, metrics, and documented execution outside the primary laptop.

Acceptance criteria: Baseline scenarios cover health, public catalog, order reads/creation where safe, and analytics with explicit pass/fail thresholds approved from evidence.

Explicitly out of scope: Invented capacity promises and production load generation.

### REL-04 — Normal, hot-SKU, spike, stress, and soak tests

Status: PLANNED | Depends on: REL-02, REL-03 | Primary: Codex | Review: Claude/Cursor, Human capacity review

Scope: Implement distinct normal-load, hot-SKU contention, spike, controlled stress, and soak scenarios with resource and correctness observations.

Acceptance criteria: Each scenario documents data shape, duration class rather than delivery estimate, thresholds, invariant checks, and safe abort conditions; results are reproducible.

Explicitly out of scope: Running destructive stress against production.

### REL-05 — Database/query and connection-pool review

Status: PLANNED | Depends on: REL-04 | Primary: Codex | Review: Claude/Cursor performance review, Human capacity approval

Scope: Review query plans, N+1 behavior, indexes, transaction duration, deadlocks, PostgreSQL/Prisma connection pooling, and API/worker aggregate connection budgets.

Acceptance criteria: Changes are measurement-backed; unnecessary indexes are avoided; process scaling cannot unknowingly exceed database limits.

Explicitly out of scope: Changing databases or adding caches as a shortcut.

### REL-06 — Infrastructure failure and recovery scenarios

Status: PLANNED | Depends on: REL-01, ASY-04, DEP-04 | Primary: Codex | Review: Claude/Cursor operations review

Scope: Verify PostgreSQL/Redis outage behavior, worker crash/restart/retry, poison jobs, partial provider failure, API graceful shutdown, and recovery documentation.

Acceptance criteria: No acknowledged durable state is lost; readiness/liveness behave as designed; retries are bounded/idempotent; operators have safe recovery steps.

Explicitly out of scope: Chaos tooling or external monitoring vendors without approval.

## Phase 13 — Data Lifecycle

### DATA-01 — Data classification and retention decision register

Status: PLANNED | Depends on: AUD-01, NOT-01, REF-02, COM-02, DLU-02, SET-02 | Primary: Human + ChatGPT architecture process | Review: Human legal/privacy/operations approval

Scope: Classify AuditLog, application logs, inventory ledger, price history, orders/business records, commerce-policy audit evidence, discount-usage records, settlement/receipt references, push installations/tokens, visitor/referral raw data, media, temporary auth state, and backups.

Acceptance criteria: Legal, privacy, volume, cost, recovery, access, deletion, and hold requirements are recorded per class; missing retention periods remain unresolved rather than guessed.

Explicitly out of scope: Inventing durations or deleting data.

### DATA-02 — Temporary-state and orphan-cleanup policy

Status: PLANNED | Depends on: DATA-01, AUTH-05, MED-01 | Primary: Human + ChatGPT architecture process, then Codex | Review: Claude/Cursor security review

Scope: Approve and implement lifecycle enforcement for OTP/session/rate-limit state, push tokens, visitor/referral raw data, media/orphans, and safe application-log handling.

Acceptance criteria: Ownership, TTL/expiry, cleanup trigger, retry/idempotency, legal holds, observability, and recovery are explicit for each implemented class.

Explicitly out of scope: Hard-deleting durable order, ledger, price, or audit history without separate approval.

### DATA-03 — Durable business records and backup lifecycle

Status: PLANNED | Depends on: DATA-01, DEP-06 | Primary: Human + ChatGPT architecture process | Review: Human legal/privacy/operations approval

Scope: Approve lifecycle, archival, access, restoration, and deletion/anonymization rules for orders, inventory ledger, price history, audit records, and backups.

Acceptance criteria: Retention and recovery objectives are evidenced and approved; destructive actions have migration/rollback plans; backup expiry aligns with deletion obligations.

Explicitly out of scope: Unapproved retention numbers and casual hard deletion.

## Phase 14 — Liara Deployment & Production Readiness

### DEP-01 — Liara runtime architecture and configuration

Status: PLANNED | Depends on: FND-08, ASY-03 | Primary: Human + ChatGPT architecture process, then Codex | Review: Claude/Cursor operations review, Human approval

Scope: Define Liara API and worker processes, scaling/resource assumptions, network dependencies, environment separation, and configuration ownership.

Acceptance criteria: API/worker commands and required PostgreSQL/Redis/object-storage connections are explicit; Docker remains optional locally; no business state uses ephemeral disk.

Explicitly out of scope: Production cutover.

### DEP-02 — PostgreSQL, Redis, object storage, and secrets

Status: PLANNED | Depends on: DEP-01, MED-01 | Primary: Human infrastructure process | Review: Claude/Cursor security review, Human approval

Scope: Provision and document environment-scoped services, least-privilege credentials, TLS/network controls, rotation, capacity, and production/development isolation.

Acceptance criteria: Secrets are not committed or logged; production Redis cannot be reused in development; object storage and backups have approved ownership and access controls.

Explicitly out of scope: Schema migration and application release.

### DEP-03 — Deployment migrations and process health

Status: PLANNED | Depends on: DEP-01, DEP-02 | Primary: Codex | Review: Claude/Cursor operations review, Human deployment approval

Scope: Add explicit `prisma migrate deploy` release step, API liveness, dependency/worker readiness, graceful shutdown, and failed-start behavior.

Acceptance criteria: Migrations are never implicit per replica; traffic/work admission respects readiness; termination drains HTTP/jobs without hiding failure.

Explicitly out of scope: Destructive migration approval and rollback automation that cannot restore data.

### DEP-04 — Staging, smoke tests, and release metadata

Status: PLANNED | Depends on: DEP-03, FND-08 | Primary: Codex | Review: Claude/Cursor, Human release approval

Scope: Establish production-like staging, post-deploy API/worker smoke tests, release version/Git SHA verification, and environment-safe fixtures.

Acceptance criteria: Smoke tests cover liveness/readiness and critical approved paths without mutating production; failed verification blocks promotion and is observable.

Explicitly out of scope: Treating staging as a substitute for integration tests.

### DEP-05 — Backup strategy and restore test

Status: PLANNED | Depends on: DEP-02 | Primary: Human infrastructure process, then Codex | Review: Human operations approval

Scope: Define PostgreSQL/object-storage backup ownership, encryption, access, recovery objectives, and a repeatable isolated restore test.

Acceptance criteria: A restore is demonstrated and reconciled, not merely configured; credentials and restored PII are protected; evidence and failure handling are documented.

Explicitly out of scope: Inventing retention periods before DATA-01/DATA-03 approval.

### DEP-06 — Rollback and production release procedure

Status: PLANNED | Depends on: DEP-03, DEP-04, DEP-05, REL-06 | Primary: Human + ChatGPT architecture process | Review: Claude/Cursor, Human release approval

Scope: Define backward-compatible rollout, application rollback, migration forward-fix/recovery, worker/API version skew, feature gating where justified, and production smoke response.

Acceptance criteria: Rollback does not assume destructive schema reversal; responsibilities and stop conditions are explicit; production release remains a human decision.

Explicitly out of scope: Automatic cutover or irreversible migration without recovery.

## Phase 15 — Migration & Cutover

### MIG-01 — Legacy behavior and contract inventory

Status: PLANNED | Depends on: FND-05 | Primary: Claude/Cursor large-context review, supported by Codex | Review: Human product/architecture approval

Scope: Inventory legacy routes, payloads, errors, auth/cookie behavior, data semantics, consumers, and undocumented edge cases across every listed legacy domain.

Acceptance criteria: Each legacy behavior has evidence, owner, intended parity/change decision, and target roadmap task; unknowns are explicit.

Explicitly out of scope: Implementing compatibility from assumptions.

### MIG-02 — Schema and data migration design

Status: PLANNED | Depends on: MIG-01, implemented target schemas | Primary: Human + ChatGPT architecture process, then Codex | Review: Claude/Cursor, Human destructive-migration approval

Scope: Map legacy identities/relationships to target schemas, define transforms/backfills, ordering, validation, rehearsal, rollback/recovery, and data reconciliation.

Acceptance criteria: Migrations are rerunnable or checkpointed as approved; counts/invariants/history reconcile; destructive or lossy cases have explicit human approval.

Explicitly out of scope: Running production migration.

### MIG-03 — Backward compatibility and OpenAPI verification

Status: PLANNED | Depends on: MIG-01, FND-05, target APIs | Primary: Codex | Review: Claude/Cursor contract review, Human product approval

Scope: Compare legacy/target OpenAPI and observed contracts, define compatibility adapters or versioned changes, and add contract/regression verification.

Acceptance criteria: Every intentional incompatibility has a consumer migration plan; response/error/auth differences are machine-tested where practical.

Explicitly out of scope: Keeping unsafe legacy behavior without review.

### MIG-04 — Frontend API client migration

Status: PLANNED | Depends on: MIG-03, AUTH-04 | Primary: Codex with frontend owner | Review: Claude/Cursor, Human frontend approval

Scope: Migrate the shared frontend client/auth/session handling to target contracts, including cookie/CSRF and refresh behavior.

Acceptance criteria: Storefront/admin consumers use generated or verified contracts; token refresh/logout and structured errors work in staging; rollback compatibility is defined.

Explicitly out of scope: Unrelated frontend redesign.

### MIG-05 — Storefront and admin staged migration

Status: PLANNED | Depends on: MIG-02, MIG-04, M5 feature parity | Primary: Codex with frontend/backend owners | Review: Claude/Cursor, Human product approval

Scope: Move storefront and admin domains in bounded waves with data/contract verification and independent rollback where practical.

Acceptance criteria: Health, Catalog, Blog, Auth/OTP, Orders, all listed Admin domains, referrals, sessions, and notification inbox have signed-off coverage before their wave completes.

Explicitly out of scope: Assuming a big-bang cutover.

### MIG-06 — Parallel validation, final cutover, and legacy retirement

Status: PLANNED | Depends on: MIG-05, DEP-06, M6 production hardening | Primary: Human production-cutover process | Review: Claude/Cursor risk review, Human final approval

Scope: Use shadow/parallel validation where practical, reconcile data/results, choose cutover strategy, execute approved smoke/rollback gates, and retire legacy API safely.

Acceptance criteria: Cutover criteria, monitoring window, rollback authority, write ownership, DNS/client sequencing, and retirement evidence are explicit; final approval is human.

Explicitly out of scope: Autonomous AI cutover and deleting legacy data/services before recovery obligations are met.

## Legacy and new-capability coverage

| Required domain/capability      | Primary roadmap tasks                         |
| ------------------------------- | --------------------------------------------- |
| Health                          | FND-01, DEP-03, DEP-04                        |
| Catalog                         | CAT-01 through CAT-06                         |
| Blog                            | CNT-01, CNT-02                                |
| Auth / OTP                      | AUTH-01 through AUTH-08                       |
| Orders                          | ORD-01 through ORD-08                         |
| Admin Auth / Admin Admins       | AUTH-03, AUTH-08, ADM-00, ADM-AUTH-01, ADM-01 |
| Admin Catalog / Regions         | CAT-02, CAT-05                                |
| Admin Media                     | CAT-04, MED-01                                |
| Admin Inventory                 | INV-01A through INV-06                        |
| Admin Discounts                 | PRC-02 through PRC-04                         |
| Admin Orders                    | ORD-06, ORD-07                                |
| Commerce ordering policy        | COM-01 through COM-03                         |
| Discount lifetime limits        | DLU-01, DLU-02                                |
| Deferred settlement             | SET-01, SET-02                                |
| Admin Analytics                 | ANL-01 through ANL-04                         |
| Admin Stores / Customers        | ADM-02                                        |
| Admin Visitors                  | REF-02 through REF-04                         |
| Admin Blog                      | CNT-02                                        |
| Refresh-token/session lifecycle | AUTH-02 through AUTH-04                       |
| User/store referral links       | REF-01 through REF-04                         |
| Durable notification inbox      | NOT-01 through NOT-05                         |

## Milestones

### M1 — Foundation complete

Complete when all Phase 0 tasks are DONE: OpenAPI and contract verification exist, Docker-free environment guidance is verified, real-infrastructure test targets are honestly separated, and release checks are defined without adding business behavior.

### M2 — Identity complete

Complete when AUTH-01 through AUTH-08 are DONE: customer/admin authentication, secure password/access/refresh/OTP/session lifecycle, registration/profile, RBAC, ownership, CSRF/cookie behavior, migrations, OpenAPI, and security/concurrency tests are approved and passing.

### M3 — Catalog + Inventory complete

Complete when CAT-01 through CAT-06 and INV-01A through INV-06 are DONE, including the ADR 0012 physical stock decrement rule (`SHIPPED`), real PostgreSQL integration/concurrency evidence, catalog/admin/public contracts, and inventory reconciliation.

### M4 — Ordering complete

Complete when PRC-01 through PRC-05, ORD-01 through ORD-08 (including ORD-03A), COM-01 through COM-03, DLU-01/DLU-02, and SET-01/SET-02 are DONE: historical snapshots, pricing/discount rules and lifetime discounted-quantity limits, configurable Order acceptance, transactional idempotent multi-item creation, Inventory integration, customer/Admin flows, deferred settlement, cancellation/returns/dispatch behavior, audit, and load/concurrency checks are approved.

### M5 — Feature parity complete

Complete when referral/visitor, notification, content/media, remaining admin, transactional async, analytics, and audit tasks through Phase 11 are DONE and the legacy/new-capability coverage table has no unowned or unverified domain.

### M6 — Production hardening complete

Complete when Phases 12 through 14 are DONE: real infrastructure and failure suites pass, measured performance/query/pool work is complete, lifecycle/retention decisions are approved, Liara API/worker/data services are staged, restore is proven, and rollback/release procedures are approved.

### M7 — Cutover ready

Complete when MIG-01 through MIG-05 are DONE, MIG-06 acceptance prerequisites pass in staging/parallel validation, data and contracts reconcile, and the human production owner has approved the chosen cutover and rollback gates. Legacy retirement occurs only after successful cutover obligations are met.

## Explicit unresolved decisions

The following are not implementation assumptions:

- Final browser access-token transport details after product confirmation of cross-site needs (`SameSite=None` only if required); numeric JWT TTLs after load confirmation (session strategy and default cookie names/attributes decided in AUTH-01 / AUTH-04 / ADR 0004).
- CSRF mechanism details (production blocker for browser cookie-authenticated mutations, including Admin cookie auth). Admin login identifier is settled as canonical email (ADM-00 / ADR 0008). Admin password policy for creation/bootstrap is length-oriented (min 12 / max 128); breach-corpus rejection and rotation remain deferred. Admin identity persistence and `PrismaAdminRoleResolver` are DONE (ADM-00). Admin sessions, login HTTP, ADMIN token issuance, namespaced cookies, and operator-controlled first-`SUPER_ADMIN` provisioning are DONE (`ADM-AUTH-01` / ADR 0009). `ADM-01` (account management) depends on ADM-AUTH-01 so disablement can revoke Admin sessions. Permissioned Admin catalog routes (CAT-02) already attach `AccessTokenGuard` + `PermissionGuard`; ADM-01 still owes the same for Admin account-management routes.
- Legacy capability evidence for the `WAREHOUSE` and `ORDER_OPS` permission grants (MIG-01). The AUTH-08 grants are provisional; widening or narrowing them is a reviewed policy change.
- Trusted reverse-proxy / Nest Express `trust proxy` configuration so OTP IP rate limits see the real client behind Liara; live Kavenegar credential smoke test when account access exists (deploy).
- Customer/store business profile fields required at registration vs later completion (store name, manager name, address, region, coordinates): no in-repo legacy inventory yet (`MIG-01`); AUTH-07 shipped Pattern A phone-only identity with empty profile update allowlist. Region **reference** rows exist (CAT-02); profile `regionId` FK remains deferred.
- Category/Region legacy parity gaps (MIG-01): name uniqueness, public slug, sortOrder, category hierarchy/parent, shipping-related Region fields, and whether hard delete is ever allowed after Product/profile FKs land.
- Product legacy parity gaps (MIG-01): SKU/code uniqueness, description, unit/package semantics, media/image attachment once CAT-04 exists, whether zero-price products should be allowed, and whether product name uniqueness is ever required.
- Order transition runtime (ORD-02) and customer create HTTP (`ORD-03A`) are DONE; customer list/detail and transition HTTP (`ORD-04`/`ORD-05`) plus Admin Orders HTTP (`ORD-06`) remain PLANNED. V1 state machine, actors, concurrency, and Inventory orchestration rules are settled in ADR 0014 / [instructions/orders.md](../instructions/orders.md). Shipping/address snapshot fields, dispatch board, return HTTP beyond ORD-07 scope, and payment/refund semantics remain deferred. Deferred settlement is separately planned in SET-01/SET-02 and must not become Order state.
- Whether a future `PACKED`/`PICKED` state should move the physical `onHand` decrement earlier than `SHIPPED`.
- Whether partial fulfillment or split shipment is ever allowed after V1.
- Public exposure of exact inventory `available`, and any preferred-customer allocation/fairness policy under contention.
- Product-discount lifetime caps are decided in [ADR 0017](adr/0017-discount-lifetime-quantity-limit.md) / DLU-01 (partial discount; PRODUCT LINE only; create consume / pre-ship release; no return restore) and implemented in DLU-02. V1 LINE-then-ORDER composition and single-winner-per-scope rules remain locked in PRC-03 / PRC-05 / [ADR 0015](adr/0015-line-then-order-discount-composition.md). Promo codes and promo-banner behavior remain unapproved.
- Deferred settlement SET-01 is BLOCKED on receipt count, receipt-versus-explicit-settle behavior, receipt-required rule, correction/reopen/detach semantics, exact Admin role grants, and stable conflicts. No gateway, card/bank fields, refunds, or accounting subsystem is approved.
- Referral attribution window/source/reassignment, duplicate/self-referral treatment, visitor conversion, and whether rewards exist at all.
- Notification type/content rules, push provider/consent, delivery guarantees, and token lifecycle.
- Media historical-reference behavior when Product/Blog/Category attach to Media (MED-01). Upload limits/types and the S3-compatible provider abstraction are decided in CAT-04 / ADR 0011; orphan cleanup remains DATA-02 (no retention periods invented). Live production-bucket verification remains pending credentials (DEP-02).
- Tehran/business-day definitions and canceled/returned treatment for each analytics metric.
- Retention periods for every data class and backup recovery objectives.
- Legacy compatibility, migration transforms, rollout waves, parallel-validation feasibility, and final cutover strategy.

## Roadmap maintenance policy

- Update task status whenever implementation state changes; keep summary counts exact.
- Do not mark a task DONE until its acceptance criteria and the repository Definition of Done are met.
- Add newly discovered work explicitly instead of silently expanding an existing task.
- Use BLOCKED only for a named architecture or business blocker; document the decision owner.
- Material changes to scope, dependencies, milestones, or architecture require review.
- ROADMAP records planned/current execution state. CHANGELOG records delivered changes; neither substitutes for the other.
- Do not add hour/day estimates or invented delivery dates. Express size through bounded scope and acceptance criteria.
