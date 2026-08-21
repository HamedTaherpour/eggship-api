# ADR 0008: Admin identity

## Status

Accepted

## Context

[ADR 0007](0007-authorization-model.md) built admin authorization against an `AdminRoleResolver` port with no implementation, so every admin authorization denied and the RBAC path was inert. Closing that gap needs a persisted Admin identity, and three questions had to be answered together because each one constrains the others.

**The login identifier.** `instructions/authentication.md` carried `email and/or username` as unresolved. Supporting both means two unique columns, two normalization rules, and an ambiguity at login about which one was supplied.

**Where admin sessions live.** [ADR 0004](0004-auth-session-strategy.md) designed tokens with an explicit `subjectType` so `ADMIN` was anticipated, but AUTH-02 persisted `AuthSession.userId` as a non-nullable FK to `User`. Reusing that table for admins requires making the subject nullable, and a nullable-pair subject (`userId`, `adminId`) is only safe with database-enforced exactly-one semantics.

**What an authenticated-but-wrong subject receives.** `instructions/authorization.md` recorded 401 for a non-customer principal on a customer flow and explicitly marked it unsettled: 401 tells a browser client to refresh and retry, and an admin session on a customer route would refresh successfully and loop. The case was unreachable while ADMIN tokens could not be issued, and changing it meant changing several call sites at once.

## Decision

**Email is the admin login identifier.** One canonical column, `Admin.email`: trimmed, lowercased, and matched against a conservative ASCII address pattern (`src/modules/admins/domain/admin-email.ts`). `username` is not added. Email is an identifier for authentication only and is never an authorization primitive — permissions derive from `role` alone, so possessing or changing an email grants nothing.

Normalization is deliberately minimal. Provider-specific folding such as Gmail dot removal is rejected: it merges addresses that are distinct at other providers, and an identity system that silently treats two different addresses as one operator is worse than one that treats them as two.

Uniqueness is enforced by a unique index, and canonical form by a `CHECK` constraint. The index is the authority rather than a prior `findByEmail`: a read-then-write check cannot exclude a concurrent creation of the same address, so `AdminRepository` translates the unique violation into `AdminEmailAlreadyExistsError`. The `CHECK` is defense in depth — a unique index compares exact bytes, so without it a writer bypassing the repository could store `Ops@x.test` alongside `ops@x.test`.

**Minimum persistence model.** `id`, `email`, `passwordHash`, `role`, `isActive`, `createdAt`, `updatedAt`. Nothing else. `username`, `avatar`, `department`, `jobTitle`, `phone`, `lastLoginIp`, and `preferences` are omitted because no approved requirement needs them, and a speculative column in a security-sensitive table is a column whose invariants nobody has reasoned about.

`role` is a PostgreSQL enum whose values are exactly `AdminRole` from ADR 0007. No `Role` or `Permission` table is introduced; a unit test compares the generated Prisma enum against the code-defined roles, so drift fails the build rather than resolving to an unknown role at runtime.

**Admin sessions are a dedicated model.** Option A (a separate `AdminAuthSession`) is implemented in ADM-AUTH-01 / [ADR 0009](0009-admin-authentication.md). `AuthSession.userId` stays a non-nullable FK, which means an admin id cannot be stored as a customer session subject — subject confusion is prevented by the schema rather than by application checks.

When admin sessions are built, the nullable-polymorphic shape is rejected in advance. A shared table would need a database-enforced exactly-one-subject constraint plus per-subject FK integrity, and the DRY saving does not pay for the integrity risk. Whichever shape is chosen must preserve every customer-session security property: UUID session id, digest-only refresh storage, explicit expiry, revocation, token family and rotation compatibility.

Consequently `AccessTokenService` issues ADMIN tokens once `AdminAuthSession` exists (ADM-AUTH-01). Claims stay minimal; role is still resolved per request.

**An authenticated principal of the wrong subject type receives 403.** Settled by the architecture owner and applied across `requireCustomerOwnerId` and `SessionLifecycleService` in one change. 401 means "authentication is missing or invalid"; a valid admin session is neither. The response body is the same generic `"Insufficient permissions."` with empty `details` as any other denial, so it still does not reveal which customer routes exist.

**The resolver states facts; authorization judges them.** `PrismaAdminRoleResolver` returns `id`, `role`, and `isActive` — never the email, so the authorization path loads no operator PII — and reports an inactive admin as `found` with `isActive: false` rather than as absent. `AuthorizationService` applies `admin_inactive`, keeping the fail-closed policy in one place. A non-UUID subject id is answered as not found without a query.

**No credential is ever created implicitly.** No seed, no default account, no committed hash, no environment default password, no automatic provisioning at startup. `AdminIdentityService.createAdmin` is the only creation path. HTTP create-admin remains out of scope; the operator CLI is `pnpm admin:create` (ADM-AUTH-01 / [ADR 0009](0009-admin-authentication.md)).

**Password policy is length-oriented.** Minimum 12 characters, maximum 128, no composition rules; hashing goes through the AUTH-03 `PasswordHasher` port (Argon2id). ADM-AUTH-01 adopted this for bootstrap/creation and added login throttling plus dummy-hash timing. Breach-corpus rejection and rotation remain deferred.

## Consequences

Admin authorization resolves real state now, so ADR 0007's role → permission policy is live rather than inert. Role and `isActive` are read from PostgreSQL per authorized admin request, which keeps the no-stale-claim property: a deactivation or role change takes effect on the next request, at the cost of one indexed lookup.

An admin logs in through ADM-AUTH-01 (`POST /api/v1/admin/auth/login`, `AdminAuthSession`, namespaced cookies, `pnpm admin:create`). General Admin account management remains `ADM-01`.

`isActive = false` denies authorization and also denies Admin login/refresh. `ADM-01` still owes session revocation on disablement and security-sensitive role changes.

Deactivation is preferred over deletion. `AdminAuthSession.adminId` uses `ON DELETE RESTRICT` so casual Admin deletion cannot orphan or cascade-wipe session history. `ADM-01` still owns disablement plus session revocation.

`Admin created`, `role changed`, `Admin disabled`, and `password reset` are security-sensitive auditable events, recorded here as a requirement for AUD-01/AUD-02. No `AuditLog` is implemented. Creation emits `admin.identity.created` with the admin id and role only — no email, password, or hash.

Two guards keep the design from eroding: a source scan asserting no file outside `common/authz` names a role in executable code, and an e2e suite asserting the 401/403 split. Admin auth-lifecycle HTTP is allowlisted without `PermissionGuard`; permissioned Admin APIs still owe the architecture test (`ADM-01`).
