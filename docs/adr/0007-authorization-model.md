# ADR 0007: Authorization model

## Status

Accepted

## Context

EggShip needs an admin authorization system before any permissioned admin API is built (CAT-05, INV-02/INV-06, ORD-06, PRC-04, ADM-01, ADM-02, CNT-02, AUD-03, REF-04, MED-01 all depend on it). Legacy EggShip has three back-office roles — `SUPER_ADMIN`, `WAREHOUSE`, `ORDER_OPS` — enforced by scattered role comparisons, which is exactly the pattern this repository must not reproduce.

Three decisions had to be made together, and each has a cheap-but-fragile option:

1. **Where policy lives.** A relational `Role`/`Permission` schema with an admin-facing editor is flexible but adds tables, cache invalidation, migration risk, and a privilege-escalation surface. There are three roles and no requirement for tenant-specific or customer-editable policy.
2. **How permissions reach a request.** Embedding a role or permission snapshot in the short-lived access token is fast but stale until expiry, and it contradicts the AUTH-01/AUTH-03 claim policy recorded in ADR 0004 ("do not embed … permissions").
3. **How `SUPER_ADMIN` works.** A `role === 'SUPER_ADMIN' → allow` short-circuit inside each guard is the common shortcut, and it silently grants every permission invented in the future, including ones nobody intended a superuser to hold.

Admin identity persistence is not available: the admin login identifier (`email` versus `username`) is still an open decision in the roadmap and in `instructions/authentication.md`, and admin account management belongs to ADM-01. The authorization architecture therefore has to be complete and useful before the Admin table exists. (Both were settled afterwards by ADM-00 and [ADR 0008](0008-admin-identity.md); the identifier is `email`.)

## Decision

**Code-defined role → permission mapping.** `Permission` and `AdminRole` are TypeScript constants, and `ROLE_PERMISSIONS` in `src/common/authz/role-permissions.ts` is the single source of truth. No Prisma model, migration, or runtime permission editor is introduced. Role assignment (which admin holds which role) is persisted data owned by the future Admins module; role _policy_ (which permissions a role holds) is reviewed code. Changing policy requires a deployment, and that is accepted: policy changes are security changes and should go through review, not a production UI.

**No role or permission claims in access tokens.** Claims stay `sub`, `subjectType`, `sessionId`, `tokenUse`, unchanged from ADR 0004. Admin role and activation state are read through an `AdminRoleResolver` port on each authorization decision, so a role change or a disablement takes effect on the next request with no stale-claim window. The cost is one indexed admin lookup per authorized admin request. No cache is added; adding one later requires documenting its staleness window.

**No `SUPER_ADMIN` bypass.** `SUPER_ADMIN` is enumerated explicitly against the full catalog and resolved through the same path as every other role. A unit test asserts the enumeration covers the catalog, so introducing a permission forces its superuser grant to be listed explicitly; withholding one requires deliberately changing that assertion. Either way the decision is visible in review rather than implicit.

**Fail closed everywhere.** A missing principal, a non-admin subject, missing or inactive admin state, a resolver answer about a different admin, an unrecognized persisted role, an unrecognized requested permission, and an empty requirement list all deny. A resolver that throws degrades to "directory unavailable" rather than escaping as a server error. `@RequirePermissions` uses ALL semantics. Denial responses carry only `AUTH_UNAUTHENTICATED` (401) or `AUTH_FORBIDDEN` (403) with no policy detail; the precise reason goes to the `authz.denied` log.

**Placement.** Authorization lives in `src/common/authz/` as `AuthorizationModule`, which imports no business module. Feature modules require permissions without `AuthModule` or a future `AdminsModule` importing them back, so permissions cannot introduce a circular dependency. Resource-specific rules stay with the owning domain; only the primitives are shared.

`AuthorizationModule` is a dynamic module (`forRoot`) for exactly one reason: the `AdminRoleResolver` implementation is owned by whichever module persists Admin identity, and a statically bound provider could only be replaced by importing that module here — recreating the cycle the placement avoids. The composition root supplies the resolver; the token itself is not exported, so no consumer can read raw role or activation state.

**Ownership is separate from permissions.** Owner scope is derived from the authenticated principal, never from client input, and owner-scoped queries constrain on id plus owner. This is the BOLA/IDOR boundary and it is independent of RBAC.

## Consequences

The RBAC path was inert in production until Admin identity persistence existed: the bound `AdminRoleResolver` reported `unavailable`, so every admin authorization denied. That fail-closed state ended with ADM-00, which supplied `PrismaAdminRoleResolver` through the seam without touching guards, decorators, or policy — the prediction in this ADR held ([ADR 0008](0008-admin-identity.md)).

Admin authorization cannot be verified end-to-end against real admin HTTP endpoints yet; coverage uses unit tests plus a test-only probe controller, and since ADM-00 also a PostgreSQL integration suite that resolves permissions through the real resolver. Those cases must be re-asserted against real endpoints as admin surfaces land.

Guard attachment stays the residual risk of this design. A handler that declares no permission fails closed, but a controller that omits `@UseGuards` is not protected at all, and no test can assert that over a route surface that does not exist yet. The first admin HTTP task owes an architecture test over the registered routes.

Every future admin task extends the permission catalog and the role policy in its own change, with its own review, rather than inheriting a speculative permission. The `WAREHOUSE` and `ORDER_OPS` grants are provisional until MIG-01 supplies legacy capability evidence; widening them is a reviewed policy change, not a migration.

Admin role changes and disablement will require refresh-session revocation to be a real security control. That requirement is recorded in `instructions/authorization.md` for the Admin persistence and ADM-01 tasks; it is not implemented here and instant access-token revocation is not claimed.

If a genuine requirement for customer-editable or tenant-scoped permissions appears, this ADR must be revisited rather than worked around with ad hoc database lookups.
