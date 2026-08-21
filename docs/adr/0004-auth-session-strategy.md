# ADR 0004: Auth session strategy

## Status

Accepted

## Context

EggShip needs long-lived storefront sessions without shipping long-lived bearer access tokens to browsers. The existing frontend direction uses cookies with CSRF protection. Customer login will be OTP-based on Iranian mobile numbers; admin login remains a separate password-based identity domain. Sessions must support multiple devices, logout/revocation, refresh rotation, and reuse detection without making Redis authoritative for durable session state.

## Decision

Use short-lived HS256 JWT access tokens (minimal claims: `sub`, `subjectType`, `sessionId`, `tokenUse=access`) paired with opaque rotating refresh tokens (`sessionId.secret`) whose digests and lifecycle are stored as server-side `AuthSession` rows in PostgreSQL.

Browser product transport is **Option A**: both access and refresh tokens in HttpOnly cookies (`eggship_at` / `eggship_rt`, `SameSite=Lax`, `Secure` in production, host-only), with CSRF protection required for state-changing cookie-authenticated requests before production browser exposure. Refresh tokens must never be stored in LocalStorage. Authorization Bearer remains supported for tooling when it does not conflict with the access cookie.

Access-token verification is signature/expiry based by default (no per-request session DB lookup and no AT blacklist). Session revocation stops refresh continuation; short AT TTL bounds residual risk. Refresh rotation is conditional and transactional; consumed digests in `AuthRefreshTokenConsumption` enable reuse detection with family-scoped revocation. Passwords use Argon2id through a provider-neutral hasher. Redis remains limited to ephemeral concerns such as OTP and rate limiting.

## Consequences

Login, refresh, logout, and CSRF middleware tasks must honor cookie names/attributes and opaque refresh semantics. AUTH-04 delivered customer refresh/logout HTTP flows and cookie helpers; ADM-AUTH-01 delivered namespaced Admin cookies (`eggship_admin_at` / `eggship_admin_rt`, Path `/api/v1/admin`) and dedicated `AdminAuthSession` persistence ([ADR 0009](0009-admin-authentication.md)). CSRF middleware remains an explicit production blocker for both cookie namespaces. Frontend migration (MIG-04) preserves cookie/CSRF behavior. Production TTL tuning remains a follow-up decision but must not violate this strategy.
