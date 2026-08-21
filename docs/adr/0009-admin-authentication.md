# ADR 0009: Admin authentication runtime

## Status

Accepted

## Context

[ADR 0008](0008-admin-identity.md) persisted Admin identity and rejected a nullable polymorphic `AuthSession` subject. Customer sessions, cookies, and refresh rotation already existed (AUTH-02–AUTH-04 / [ADR 0004](0004-auth-session-strategy.md)). ADMIN access-token issuance was blocked because `sessionId` must reference a real Admin refresh session. There was no login HTTP surface and no operator-controlled way to create the first privileged Admin.

Storefront and back-office may share a browser. Reusing `eggship_at` / `eggship_rt` would let one login overwrite the other. Future Liara hostname topology is not yet decided, so cookie isolation must not depend on hardcoded production domains.

## Decision

**Dedicated `AdminAuthSession` and `AdminAuthRefreshTokenConsumption`.** Same security properties as User sessions (UUID id, digest-only refresh storage, token family, expiry, revocation, conditional rotation, consumed-digest reuse detection with race grace). `AuthSession.userId` stays non-nullable. User consumption rows never reference Admin sessions. Shared lifecycle primitives (`classifyRefreshDigestMismatch`, refresh-token hash shape, `RefreshTokenService`) are reused; persistence and application services stay subject-specific.

**Namespaced Admin cookies.** `eggship_admin_at` / `eggship_admin_rt`, `Path=/api/v1/admin`, otherwise the same HttpOnly / Secure-in-production / SameSite=Lax / host-only policy as customer cookies. Access-token extraction selects the cookie by path segment `admin`. Bearer remains accepted when it does not conflict with the path-appropriate cookie.

**Separate Admin auth HTTP.** `POST /api/v1/admin/auth/login`, `GET /me`, `POST /refresh`, `POST /logout`, `POST /logout-all`. A User refresh token cannot rotate an Admin session. Wrong authenticated subject is 403.

**ADMIN access tokens** carry `sub`, `subjectType=ADMIN`, `sessionId` (`AdminAuthSession.id`), `tokenUse=access`. Role and permissions stay out of claims; `ADMIN_ROLE_RESOLVER` continues to read PostgreSQL per request ([ADR 0007](0007-authorization-model.md)).

**Dummy Argon2id hash** computed once at process start for unknown-email login verifies. Unknown/wrong credentials return `AUTH_INVALID_CREDENTIALS`. Inactive Admin after successful password verify returns `AUTH_ACCOUNT_DISABLED`.

**Login throttling** uses email HMAC fingerprint + request IP windows. Redis when configured; in-process memory in development/test; production without Redis fails closed.

**Operator bootstrap** is `pnpm admin:create`: never automatic, explicit email and role (no default role), hidden or explicit-env password, masked database identity, production confirmation token. No default credentials.

**CSRF** remains the shared production blocker for cookie-authenticated mutations. Admin cookie auth is not production-ready until that middleware lands.

`isActive` is checked before refresh rotation, not inside the rotate transaction (same shape as customer AUTH-04). A disable overlapping an in-flight refresh can still mint a short-lived access token; `ADM-01` must revoke Admin sessions on disablement so stolen refresh tokens cannot continue after the operator action.

## Consequences

Back-office login is possible without weakening User session integrity or mixing cookie jars. `ADM-01` must revoke Admin refresh sessions on disablement and security-sensitive role changes. Breach-corpus password rejection and rotation remain deferred.
