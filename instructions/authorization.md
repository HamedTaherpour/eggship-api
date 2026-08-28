# Authorization

Canonical authorization and ownership policy for EggShip API. Authentication (identity proof) lives in [authentication.md](authentication.md). The role/permission architecture decision lives in [ADR 0007](../docs/adr/0007-authorization-model.md).

This policy records the AUTH-08 implementation. Code lives in `src/common/authz/`.

## Distinctions

| Concern        | Question                                 | Enforced where                                    |
| -------------- | ---------------------------------------- | ------------------------------------------------- |
| Authentication | Who are you?                             | `AccessTokenGuard` / session-token verification   |
| Authorization  | May you perform this **action**?         | `PermissionGuard` / `AuthorizationService`        |
| Ownership      | May you perform it on **this resource**? | Server-side owner scoping in application services |

- Authentication success does **not** imply authorization.
- Admin permissions do **not** replace customer ownership checks on user-owned resources unless an explicit admin capability is approved.
- Frontend role/permission displays are never authoritative.

## Fail-closed contract

Authorization denies unless a decision explicitly grants. Every one of the following denies:

| Condition                                             | Denial reason (log only)       |
| ----------------------------------------------------- | ------------------------------ |
| No authenticated principal                            | `unauthenticated`              |
| Principal is not `subjectType = ADMIN`                | `subject_not_admin`            |
| Admin identity persistence unavailable or unreachable | `admin_directory_unavailable`  |
| Admin record not found                                | `admin_not_found`              |
| Resolver answered about a different admin             | `admin_identity_mismatch`      |
| Admin record inactive                                 | `admin_inactive`               |
| Persisted role is not a known `AdminRole`             | `unknown_role`                 |
| A required permission is not in the catalog           | `unknown_permission_requested` |
| A guarded route declares no permissions               | `no_permissions_requested`     |
| Role policy lacks a required permission               | `missing_permission`           |

There is no default-allow branch and no implicit superuser access. Additional rules that make the contract hold under failure and misconfiguration:

- A throwing `AdminRoleResolver` is an availability incident, not an authorization answer. It degrades to `admin_directory_unavailable` and logs `authz.admin_lookup_failed` at error level, so an admin-directory outage denies with telemetry instead of surfacing as a 500.
- Authentication is evaluated **before** the requirement list. A misconfigured route therefore answers `401` to an anonymous caller exactly like a correct one, so wiring defects cannot be fingerprinted without credentials and anonymous traffic cannot drive error-level logs.
- `no_permissions_requested` and `unknown_permission_requested` are wiring defects: for an authenticated caller they deny **and** log at error level. Any authenticated subject can therefore drive error-level logs on a misconfigured route, including a customer; the precondition is a wiring defect that the owed admin-route architecture test is meant to prevent, so this is accepted rather than rate-limited.
- A denial reason is a log field. It must never reach a response body.

## Role / permission model

```text
Role       → named collection of Permissions (policy configuration)
Permission → a single allowed action (the authorization primitive)
```

Initial roles (`src/common/authz/admin-role.ts`), carried forward from legacy EggShip back-office operations:

```text
SUPER_ADMIN
WAREHOUSE
ORDER_OPS
```

Initial permission catalog (`src/common/authz/permission.ts`), derived from the legacy admin capability domains in the [roadmap](../docs/ROADMAP.md) coverage table:

```text
CATALOG_READ      CATALOG_MANAGE
MEDIA_READ        MEDIA_MANAGE
INVENTORY_READ    INVENTORY_ADJUST
ORDER_READ        ORDER_TRANSITION
DISCOUNT_READ     DISCOUNT_MANAGE
COMMERCE_POLICY_MANAGE
CUSTOMER_READ     VISITOR_READ
CONTENT_READ      CONTENT_MANAGE
ANALYTICS_READ    AUDIT_READ
ADMIN_READ        ADMIN_MANAGE
```

`COMMERCE_POLICY_MANAGE` is implemented by COM-02. It gates both Commerce policy Admin reads and mutations in V1 and is granted only to `SUPER_ADMIN` through the central role policy enumeration; there is no separate commerce read permission or role branch. SET-02 implements `SETTLEMENT_READ` and `SETTLEMENT_MANAGE`, granted in V1 only to `SUPER_ADMIN` by explicit enumeration; `WAREHOUSE`/`ORDER_OPS` settlement grants remain an explicit unresolved decision pending MIG-01 evidence.

Role → permission policy is centralized in `src/common/authz/role-permissions.ts`:

| Role          | Permissions                                                                         |
| ------------- | ----------------------------------------------------------------------------------- |
| `SUPER_ADMIN` | every catalogued permission, enumerated explicitly                                  |
| `WAREHOUSE`   | `INVENTORY_READ`, `INVENTORY_ADJUST`, `CATALOG_READ`, `MEDIA_READ`, `ORDER_READ`    |
| `ORDER_OPS`   | `ORDER_READ`, `ORDER_TRANSITION`, `INVENTORY_READ`, `CATALOG_READ`, `CUSTOMER_READ` |

`WAREHOUSE` has **`ORDER_READ` only** for Orders — no transition permission. `ORDER_OPS` and `SUPER_ADMIN` may confirm, cancel, ship, and deliver via `ORDER_TRANSITION`.

Rules:

- Controllers and services must **not** branch on a role (`if (role === 'WAREHOUSE')`). Check permissions.
- Permission identifiers are domain-oriented and stable. Do not introduce `CAN_DO_X`, `PERMISSION_001`, or `ADMIN_ALL`.
- Never use bare string literals for permissions in application code; use the `Permission` constant.
- A permission that no endpoint requires grants nothing. Adding a permission is safe; granting it is the decision.
- Granularity inside a domain stays coarse until the owning roadmap task has evidence for finer actions. The owning task extends the catalog and the role policy in the same change.
- **`ORDER_TRANSITION` stays coarse for V1** (ORD-02A / [ADR 0014](../docs/adr/0014-order-state-machine-and-transition-authorization.md)): one permission covers confirm, cancel, ship, and deliver. Do not introduce `ORDER_CANCEL`, `ORDER_SHIP`, or `ORDER_DELIVER` until a later task has evidence for finer admin actions.
- Role policy is code, so a policy change requires a deployment. That is the accepted trade-off (ADR 0007); do not add a database-driven permission editor without an approved requirement.

### SUPER_ADMIN

`SUPER_ADMIN` has **no bypass**. It is granted every permission by explicit enumeration in the role policy, and it flows through the same resolution path as every other role. Consequences:

- Adding a permission does not automatically grant it to `SUPER_ADMIN`; a unit test fails until that grant is explicitly listed. Withholding one from `SUPER_ADMIN` means deliberately changing that assertion, which is the point — it cannot happen by omission in either direction.
- An inactive or unknown-role `SUPER_ADMIN` is denied like any other admin.
- Role does not bypass ownership, validation, transaction, or audit rules.

## Permission resolution

`AuthorizationService` (`src/common/authz/authorization.service.ts`) is the only place that turns a principal into permissions:

```text
getPermissions(principal)                  → Promise<ReadonlySet<Permission>> (empty when not an authorized admin)
hasPermission(principal, permission)       → Promise<boolean>
authorize(principal, permissions)          → Promise<decision>   typed; for application code
authorizeReflected(principal, unknown[])   → Promise<decision>   untyped; for PermissionGuard only
requirePermissions(principal, permissions) → Promise<void>, throws AuthError on denial
```

Every method is asynchronous because admin state is resolved per request. Awaiting is not optional; `no-misused-promises` will catch a forgotten `await`, but write it deliberately.

Rules:

- Controllers must not inspect token claims or role values to make authorization decisions.
- `authorize` and `requirePermissions` accept catalogued `Permission` values only, so a bare string or a typo is a compile error rather than a silent denial. `authorizeReflected` exists for route metadata, which is untyped by nature, and treats anything uncatalogued as a wiring defect.
- A granted decision carries permissions and deliberately **not** the role name, so no caller can be tempted to branch on a role.
- Check several permissions with one `authorize`/`requirePermissions` call. Repeated `hasPermission` calls resolve admin state repeatedly.
- Authorizing outside `PermissionGuard` (in an application service) bypasses the guard's `authz.denied` logging. The calling service is responsible for logging the denial with its own module context.

Admin role and activation state are read through the `AdminRoleResolver` port, and the resolver's answer is validated against the requesting principal (`admin_identity_mismatch`) as defense in depth at the persistence boundary.

`PrismaAdminRoleResolver` (`src/modules/admins/infrastructure`) is the bound implementation. It reads only `id`, `role`, and `isActive` — never the email — so the authorization path loads no operator PII, and it reports facts rather than verdicts: an inactive admin is returned as `found` with `isActive: false`, and `AuthorizationService` applies `admin_inactive`. The fail-closed default (`AdminPersistenceUnavailableRoleResolver`) remains the binding whenever no resolver is supplied, so a composition mistake denies. `AuthorizationModule.forRoot()` exists precisely so the module that owns Admin identity can supply the resolver without `common/authz` importing a business module:

```ts
AuthorizationModule.forRoot({
  imports: [AdminsModule],
  adminRoleResolver: {
    provide: ADMIN_ROLE_RESOLVER,
    useExisting: PrismaAdminRoleResolver,
  },
});
```

Guards, decorators, and policy did not change when it landed. `ADMIN_ROLE_RESOLVER` is intentionally not exported from the module: consumers authorize through `AuthorizationService` and never read raw role or activation state.

## Token claims vs live permissions

Access tokens carry `sub`, `subjectType`, `sessionId`, and `tokenUse` only. **No role and no permission claim** is embedded, preserving the AUTH-01/AUTH-03 claim policy ([ADR 0004](../docs/adr/0004-auth-session-strategy.md)).

Consistency model:

| Property                          | Behavior                                                 |
| --------------------------------- | -------------------------------------------------------- |
| Role/permission change visibility | Effective on the **next request**; no stale-claim window |
| Admin disablement                 | Denies authorization on the next request                 |
| Cost                              | One admin lookup per authorized admin request            |

Caching admin role lookups is deliberately not implemented. Any future cache must state its staleness window here; do not add one silently.

Admin persistence now backs this model: role and `isActive` are read from PostgreSQL on every authorized admin request, so a deactivation is effective immediately for authorization.

Related requirements for Admin management (`ADM-01`):

- Security-sensitive role changes and disablement must revoke the admin's refresh sessions; a short access-token TTL alone is not revocation.
- Do not claim instant access-token revocation. Access tokens are not blacklisted.

A disabled Admin cannot log in or refresh (ADM-AUTH-01). Authorization also denies on the next request via per-request role resolution.

## Guard and decorator usage

```ts
@Controller('admin/inventory')
@UseGuards(AccessTokenGuard, PermissionGuard)
export class AdminInventoryController {
  @Post('adjustments')
  @RequirePermissions(Permission.INVENTORY_READ, Permission.INVENTORY_ADJUST)
  adjust(): Promise<AdjustmentResponseDto> {
    /* ... */
  }
}
```

- `@RequirePermissions(...)` semantics are **ALL**: the principal must hold every listed permission. There is no ANY variant; add one only when a real requirement exists, and give it a distinct name.
- Controller-level and handler-level declarations are **unioned** into one required set.
- At least one permission is required by the type signature, and an empty requirement denies at runtime.
- `PermissionGuard` does not authenticate. Place it after the authenticating guard; a missing principal denies rather than falling through as anonymous.
- A feature module needs **no import** to use permissions. `AuthorizationModule.forRoot()` is registered once in `AppModule` and is global, so `AuthorizationService` and `PermissionGuard` are injectable anywhere. Do **not** write `imports: [AuthorizationModule]` (that instantiates the bare class with no providers) and do **not** call `forRoot()` a second time (that builds a second `AuthorizationService` bound to the fail-closed default resolver, which would silently deny that module's admin routes after the real resolver lands). Feature modules never depend on `AuthModule` for authorization.

Guard attachment is the weakest link in this design: a handler that declares no permission fails closed, but a controller that forgets `@UseGuards` is not protected at all. Therefore:

- Every admin controller attaches both guards at the class level, never per handler.
- The first **permissioned** admin HTTP surface (`ADM-01` or catalog/admin APIs) must add an architecture test asserting that every registered permissioned admin route carries `AccessTokenGuard`, `PermissionGuard`, and permission metadata. `ADM-AUTH-01` allowlists `/admin/auth/*` lifecycle routes: login/refresh/logout are unauthenticated or optional-AT; `/me` and logout-all authenticate without a resource permission. Reviewers treat a missing guard on a permissioned Admin route as a blocking finding.

## Feature-owned policy

Core authorization supplies the principal, the permission catalog, resolution, guards, and decorators. Resource-specific rules stay with the module that owns the resource.

| Concern                                     | Owner                             |
| ------------------------------------------- | --------------------------------- |
| Session/token authentication                | Auth                              |
| Permission catalog, role policy, guards     | `src/common/authz`                |
| Principal → owner-id derivation (primitive) | `src/common/authz`                |
| Admin identity, role assignment, resolver   | Admins                            |
| Resource ownership and transition rules     | The module that owns the resource |

Deriving an owner id from a principal is a shared primitive, so it lives in `common/authz`; deciding what that owner may do with a given resource is a domain rule and stays with the owning module. Do not centralize domain policies in Auth or in `common/authz`. Order authorization policy belongs to Orders; inventory adjustment policy belongs to Inventory. Do not build a generic rules engine.

### Dependency direction

`AuthorizationModule` imports no business Nest module, so no module graph cycle is possible. At source level, `common/authz` does import from Auth, in two different ways that deserve separate treatment:

| Import                                                                                           | Precedent                                                                                                                | Status               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| `modules/auth/domain`: `AuthenticatedPrincipal`, `AuthSubjectType`, `AuthError`, `AuthErrorCode` | `common/http/api-exception.filter.ts` already does this                                                                  | Established          |
| `modules/auth/api`: `getAuthenticatedPrincipal`                                                  | None — `modules/users/api` consumes it, but that is module-to-module, not `common` reaching into a feature's `api` layer | **New with AUTH-08** |

Both are accepted for now because the imported surface is a type plus one pure accessor, with no Nest dependency and no cycle. One condition is recorded: if `AuthModule` ever needs to require a permission, the principal contract (`AuthenticatedPrincipal`, `AuthSubjectType`, the request key, and the accessor) must first move to a neutral location such as `src/common/auth-context/`, with Auth importing it from there. Do not add a back-edge from Auth into `common/authz` instead.

## Ownership

Ownership is a different question from permission, and it is always answered server-side.

- Derive the owner scope for a customer-owned resource from the authenticated principal via `requireCustomerOwnerId` (`src/common/authz/resource-ownership.ts`). That is the only approved source of an owner identifier for resource access. Auth's own session-lifecycle operations (`logout`, `logout-all`) gate on subject type inline because they act on sessions rather than on an owned resource; do not copy that pattern into resource code. Both paths answer 403 for a wrong subject type.
- Prefer a single owner-scoped query (`where: { id, userId: ownerId }`) over `findById` followed by a comparison, when it is equally clear.
- Never trust a client-supplied owner id for an authorization decision.
- Cross-module reads must not bypass the owning module's invariants ([architecture.md](architecture.md)).
- An admin principal is rejected by the customer ownership helper on purpose, as `AUTH_FORBIDDEN`. Admin access to a customer-owned resource is a separate permissioned capability with its own DTO and data-minimization rules, not a reuse of the customer flow.
- The ownership boundary currently emits no `authz.denied` event, so cross-subject probing at that boundary is less visible than at the RBAC boundary. The task that adds the first owner-scoped resource endpoints should emit a denial event from the owning service.

Examples:

- Read own orders: authenticated `USER` and `order.userId === principal.subjectId`.
- Cancel own pending order: authenticated `USER`, owner-scoped lookup, and order in `PENDING_REVIEW` — **ownership-based**, not RBAC. Customer cancel does not require `ORDER_TRANSITION` or any admin permission ([ADR 0014](../docs/adr/0014-order-state-machine-and-transition-authorization.md)).
- Update own profile: target derived from the principal; no id accepted from the client.
- Admin order transitions: require `ORDER_TRANSITION` plus Orders domain preconditions; not owner-scoped.

### BOLA / IDOR prevention

Broken object-level authorization is prevented by construction:

- `userId`, `ownerId`, `storeId`, `adminId`, and equivalent scope selectors are **never** read from a request body, query string, path parameter, or header to choose whose data is accessed.
- Path parameters identify **which** resource, never **whose** resource. The owner constraint is always added from the principal.
- Mass assignment is blocked with explicit allowlists. `role`, `isActive`, and ownership columns are never client-writable ([security.md](security.md)).
- List endpoints for user-owned resources filter by the principal's owner id in the query, not after fetching.

## Errors and HTTP status

| Situation                                            | Code                    | Status |
| ---------------------------------------------------- | ----------------------- | ------ |
| No or invalid authentication                         | `AUTH_UNAUTHENTICATED`  | 401    |
| Authenticated but not permitted                      | `AUTH_FORBIDDEN`        | 403    |
| Authenticated with the wrong subject type            | `AUTH_FORBIDDEN`        | 403    |
| Authenticated customer whose own account is disabled | `AUTH_ACCOUNT_DISABLED` | 403    |

`AUTH_FORBIDDEN` responses are deliberately generic: `"Insufficient permissions."` with empty `details`. Do not return the failed permission, the subject's role, or any other policy detail to a client. If an Admin UI later needs the acting admin's own permission set, expose it through an explicit authenticated "my permissions" endpoint rather than by enriching denial responses.

Two consequences of that generality, both intentional:

- An **inactive admin** receives `AUTH_FORBIDDEN`, not `AUTH_ACCOUNT_DISABLED`. `AUTH_ACCOUNT_DISABLED` tells a subject about its own account during authentication; an authorization denial must not confirm admin account state to a caller that has not been authorized. The precise reason (`admin_inactive`) stays in the log.
- A **non-customer principal on a customer flow** receives `AUTH_FORBIDDEN` (403), not `AUTH_UNAUTHENTICATED`. Settled by the architecture owner in ADM-00 and applied to every call site in one change: a browser client treats 401 as "refresh, then retry", so an admin session on a customer route would refresh successfully and retry into a loop, where 403 is terminal. Authentication status and authorization outcome are separate answers, and conflating them is what produced the loop.

  The response body is the same generic `"Insufficient permissions."` with empty `details` as any other denial, so it still does not tell an admin token which customer routes exist.

### 403 versus 404 for owner-scoped resources

Both are correct in different places; choose deliberately and document per endpoint.

| Endpoint shape                                                           | Policy                                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Customer resource addressed by an id the client could guess or enumerate | Return `404`. An owner-scoped query naturally yields "not found", which avoids confirming that another user's resource exists. |
| Admin endpoint where the caller lacks a permission                       | Return `403`. Existence is not a secret from an authenticated operator, and `403` is actionable.                               |
| Customer endpoint where the subject type or account state is wrong       | Return `403` per the table above; this is not resource enumeration.                                                            |

Do not apply one rule blindly. The rule for each future resource endpoint is recorded with that endpoint's contract.

## Observability and audit

Authorization logging and business audit are separate concerns.

| Concern                   | Destination          | Rule                                                                                                                                                                       |
| ------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization denial      | Structured log       | `authz.denied` with `module`, `operation`, `reason`, `subjectType`, subject id, and required permission identifiers. Denials are **not** written to `AuditLog` by default. |
| Successful admin mutation | Business audit trail | Recorded by the owning domain once `AUD-01`/`AUD-02` exist                                                                                                                 |

- Denials log at `warn`; wiring defects and admin-directory failures log at `error`.
- Do not emit a log per successful permission resolution; that is high-volume noise with no security value.
- Never log tokens, cookies, `Authorization` headers, or PII. Use `requestId`/`correlationId` from the request context ([observability.md](observability.md)).

## Customer / store authorization

Storefront users authorize through **authentication + ownership**, not admin RBAC. A `USER` subject never resolves admin permissions and must never be modeled as an admin with an empty role. Customer authentication routes (`POST /api/v1/auth/complete`, `GET /api/v1/auth/me`, `PATCH /api/v1/users/me`) require no permission and are unaffected by admin RBAC.

## Planned admin authorization tests

Covered today through a test-only probe controller at the HTTP boundary, and to be re-asserted against real endpoints as admin surfaces land:

- `WAREHOUSE` cannot manage Admins.
- `ORDER_OPS` cannot adjust inventory unless explicitly granted.
- `SUPER_ADMIN` can perform approved operations.
- A `USER` subject cannot call admin APIs.
- An inactive admin, an unknown role, and a missing admin record are all denied.
- A failing or malformed admin directory denies rather than returning a server error.

Covered end to end (`test/subject-separation.e2e-spec.ts` and `test/admin-auth.e2e-spec.ts`):

- An authenticated `ADMIN` receives 403 on `GET /api/v1/auth/me`, `PATCH /api/v1/users/me`, and `POST /api/v1/auth/logout-all`.
- An authenticated `USER` receives 403 on `GET /api/v1/admin/auth/me`.
- Admin login/refresh/logout cookies are namespaced (`eggship_admin_at` / `eggship_admin_rt`).

Covered by a source guard (`src/common/authz/admin-route-guards.spec.ts`):

- The only Admin controller without `PermissionGuard` is the auth-lifecycle controller. Future permissioned Admin controllers must attach both guards and permission metadata.

Covered against real persistence (`tests/integration/postgres/admin-identity.integration-spec.ts`):

- Permission resolution through the real `AdminRoleResolver` over PostgreSQL, plus deactivated-admin, unknown-admin, and `USER`-subject denials.

Covered by a source guard (`src/common/authz/role-branching.spec.ts`):

- No file outside `common/authz` names a role in executable code, which is the enforceable form of "never branch on a role".

Not yet covered anywhere:

- Permissioned Admin management/catalog routes carrying both guards (owed by ADM-01 / the first permissioned admin API). Auth-lifecycle `/admin/auth/*` is allowlisted.

Covered by CAT-04 Admin Media controllers (`admin-route-guards.spec.ts` plus `test/media-library.e2e-spec.ts`):

- Permissioned Admin media routes carry `AccessTokenGuard`, `PermissionGuard`, and `@RequirePermissions`.
- `WAREHOUSE` can list (`MEDIA_READ`) but cannot upload/delete without `MEDIA_MANAGE`.
- `ORDER_OPS` cannot call Admin Media APIs.
- A `USER` subject cannot call Admin Media APIs.

Covered by CAT-02 Admin category/region controllers (`admin-route-guards.spec.ts` plus `test/catalog-reference.e2e-spec.ts`):

- Permissioned Admin catalog routes carry `AccessTokenGuard`, `PermissionGuard`, and `@RequirePermissions`.
- `WAREHOUSE`/`ORDER_OPS` can list (`CATALOG_READ`) but cannot create/update without `CATALOG_MANAGE`.
- A `USER` subject cannot call Admin catalog APIs.

## Unresolved authorization details

1. Legacy capability evidence for `WAREHOUSE` and `ORDER_OPS` (MIG-01). The current grants are provisional and may widen or narrow.
2. Whether an admin role lookup cache is justified, and its staleness window. Resolution is per-request from PostgreSQL today, which is the safe default: a role change or deactivation takes effect on the next request with no staleness window.
3. Admin impersonation — out of scope unless a later task approves it.
4. Any organization/tenant scoping — not approved.

**Settled (ORD-02A):** `ORDER_TRANSITION` remains coarse for V1. Customer cancel is ownership-based, not RBAC. Finer per-transition permissions are deferred until a future task has evidence.

**Implemented (SET-02):** V1 settlement authorization uses `SETTLEMENT_READ` / `SETTLEMENT_MANAGE`, granted only to `SUPER_ADMIN` by explicit enumeration; every Admin settlement route has both guards and permission metadata, and there are no customer settlement APIs. `WAREHOUSE`/`ORDER_OPS` settlement grants remain an explicit decision pending MIG-01 capability evidence.
