# Authentication

Canonical identity and authentication policy for EggShip API. Authorization and ownership live in [authorization.md](authorization.md). Session strategy rationale lives in [ADR 0004](../docs/adr/0004-auth-session-strategy.md). OTP verification-grant handoff rationale lives in [ADR 0005](../docs/adr/0005-otp-verification-grant.md). Redis→PostgreSQL consume-first session handoff lives in [ADR 0006](../docs/adr/0006-verification-grant-session-handoff.md). Role/permission architecture lives in [ADR 0007](../docs/adr/0007-authorization-model.md). Admin identity and session placement live in [ADR 0008](../docs/adr/0008-admin-identity.md). Admin authentication runtime lives in [ADR 0009](../docs/adr/0009-admin-authentication.md).

This policy records AUTH-01 decisions, AUTH-02 persistence, AUTH-03 token infrastructure, AUTH-04 refresh/logout lifecycle, AUTH-05 OTP policy/primitives, AUTH-06 public OTP HTTP + verification-grant handoff, AUTH-07 customer auth completion / current-user profile, AUTH-08 admin RBAC, ADM-00 Admin identity persistence, and ADM-AUTH-01 Admin login/session HTTP. CSRF middleware remains a later production blocker for cookie-authenticated browser mutations (customer and Admin). Do not invent endpoints here beyond what those tasks deliver.

## Identity categories

EggShip has two separate identity domains:

| Subject      | Authenticated entity                    | Primary credential (initial) | Future tokens            |
| ------------ | --------------------------------------- | ---------------------------- | ------------------------ |
| Store / User | Customer storefront account (the store) | Iranian mobile OTP           | Access + refresh session |
| Admin        | Back-office operator                    | Password                     | Access + refresh session |

Do not share credential tables, login endpoints, or permission models between User and Admin. Tokens must carry an explicit `subjectType` (`USER` \| `ADMIN`).

## User / store identity decision

The authenticated storefront subject **is the store account itself**.

- One `User` record is both the login identity and the customer/store account root.
- Do **not** invent a separate `Store` entity solely to wrap the same account.
- Business profile fields (name, address, referral metadata, and similar) may be columns on `User` or a later 1:1 profile extension owned by the Users module. Auth must not absorb speculative profile fields.
- Do **not** introduce multi-user-per-store membership unless a separate architecture task approves it.

Minimum identity fields (conceptual; schema in AUTH-02):

```text
id
phone          # canonical unique identity
status         # active/disabled lifecycle as required
createdAt
updatedAt
```

### Canonical Iranian phone

| Rule           | Decision                                                               |
| -------------- | ---------------------------------------------------------------------- |
| Storage format | E.164 with Iran country code: `+989121234567`                          |
| Uniqueness     | Database unique constraint on canonical phone                          |
| Input          | Later Auth tasks may accept `09…`, `9…`, `0098…`, `+98…` and normalize |

Canonical form is always `+98` followed by a 10-digit national mobile number that starts with `9` (example: `+989121234567`). Reject numbers that cannot normalize to that shape. Domain helper: `src/modules/users/domain/iranian-phone.ts`.

Legacy storage format reconciliation (if any) belongs to migration inventory (MIG-*), not silent dual formats in the new API.

## Admin identity decision

Admin is a separate authorization domain from User.

The login identifier is **email**, decided by the architecture owner and shipped in ADM-00. `username` is not added; a future product requirement would have to justify it. Email identifies an operator for login only and is never an authorization primitive — permissions come from `role` alone.

Identity fields as persisted (`Admin`, [ADR 0008](../docs/adr/0008-admin-identity.md)):

```text
id             # uuid
email          # canonical, unique
passwordHash   # Argon2id, never plaintext
role           # AdminRole enum
isActive
createdAt
updatedAt
```

Canonical email is trimmed, lowercased, and matched against a conservative ASCII pattern (`src/modules/admins/domain/admin-email.ts`). Only the canonical form is persisted, a unique index enforces identity, and a database `CHECK` rejects a non-canonical value even from a writer that bypassed the repository. Lookups normalize with the same function, so capitalization cannot produce a spurious "no such admin". Do not implement provider-specific folding such as Gmail dot removal: it would merge distinct addresses.

- Do not copy legacy seed credentials into this repository.
- Do not create admin seed credentials, default passwords, or committed hashes in any task or environment.
- Admin password authentication is initial; User OTP remains separate.

ADM-00 delivered Admin persistence and the `ADMIN_ROLE_RESOLVER` implementation. ADM-AUTH-01 delivered Admin sessions, login HTTP, ADMIN token issuance, and `pnpm admin:create`. Still owed:

- revoke the admin's refresh sessions on disablement and on security-sensitive role changes (`ADM-01`), since access tokens are not blacklisted.

Role, `isActive`, and `passwordHash` are security-sensitive columns. There is no generic admin update path and no client-writable role: future management uses explicit named operations with their own authorization, and `AdminIdentityService` exposes creation only. `Admin created`, `role changed`, `Admin disabled`, and `password reset` are auditable events for AUD-01/AUD-02; deactivation via `isActive = false` is preferred over deletion so that history is not destroyed.

## Module boundaries

Preferred Nest modules (introduced when implementation tasks need them—not as empty shells):

| Module         | Owns                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `AuthModule`   | Authentication, sessions, tokens, login/logout/refresh application flows, CSRF integration when added |
| `UsersModule`  | Customer/store identity, phone rules, profile fields, ownership helpers for user resources            |
| `AdminsModule` | Admin identity, password credential storage boundary, admin management APIs later                     |

Cross-module rules:

- Auth issues and validates sessions/tokens; it does not own store profile business fields.
- Users/Admins own identity records; Auth references them by id + `subjectType`.
- Controllers stay thin. Domain code must not import Nest HTTP decorators.
- Prisma types stay in infrastructure; domain and API DTOs do not re-export them.

Suggested Level-B layout when Auth implementation begins:

```text
src/modules/auth/
  api/
  application/
  domain/
  infrastructure/
  tests/
```

## Browser authentication constraint

The EggShip frontend uses **cookie-based authentication with CSRF protection**. This remains an architectural constraint.

- Do **not** switch browser clients to LocalStorage (or SessionStorage) refresh-token storage.
- Cookie-authenticated browser state-changing requests require CSRF protection ([security.md](security.md)).
- CSRF middleware is **not** implemented. Customer and Admin `refresh`, `logout`, and `logout-all` are designed so CSRF middleware can wrap them, but **cookie-authenticated browser mutation security is not production-complete until CSRF lands**. Admin cookie auth is production-blocked by the same issue; do not invent a separate Admin CSRF mechanism.

### Token transport (AUTH-03 / AUTH-04)

| Token         | Lifetime intent | Browser transport                                  | Notes                                                                      |
| ------------- | --------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| Access token  | Short-lived     | HttpOnly `eggship_at` or `eggship_admin_at` cookie | Authorization Bearer also accepted for tooling/tests                       |
| Refresh token | Longer-lived    | HttpOnly `eggship_rt` or `eggship_admin_rt` cookie | Never expose to JavaScript; never accept from query strings or JSON bodies |

Access-token extraction precedence (per request path):

1. Admin HTTP paths (a path segment equal to `admin`) read `eggship_admin_at`. All other paths read `eggship_at`. The opposite namespace is ignored so storefront and Admin sessions in the same browser cannot overwrite or substitute for each other.
2. If both Bearer and the path-appropriate access cookie are present, values must be identical; conflicting values → `AUTH_INVALID_TOKEN`.
3. Otherwise use whichever single source is present.

Cookie attributes (AUTH-04 / ADM-AUTH-01):

- `HttpOnly`: required for both namespaces
- `Secure`: required when `NODE_ENV=production`
- `SameSite`: `Lax` (host-only; `None`+`Secure` only after explicit cross-site review)
- `Path`: `/` for customer cookies; `/api/v1/admin` for Admin cookies
- `Domain`: omitted (host-only) unless multi-subdomain needs are approved
- `Max-Age`: access TTL for AT; remaining session lifetime for RT

CORS for credentialed browser calls must use an explicit origin allowlist and must never use `*` with credentials ([security.md](security.md)).

## Session model

Refresh lifecycle is **server-side session persistence** in PostgreSQL. User and Admin sessions are **separate tables**. Do not make `AuthSession.userId` nullable and do not store an Admin id as a User session subject ([ADR 0008](../docs/adr/0008-admin-identity.md), [ADR 0009](../docs/adr/0009-admin-authentication.md)).

```text
AuthSession (User only)
  id
  userId
  refreshTokenHash     # digest of current refresh token only
  tokenFamilyId
  expiresAt
  revokedAt
  lastUsedAt
  createdAt
  updatedAt

AdminAuthSession (Admin only)
  id
  adminId
  refreshTokenHash
  tokenFamilyId
  expiresAt
  revokedAt
  lastUsedAt
  createdAt
  updatedAt
```

Constraints:

- Do **not** store raw refresh tokens.
- Do **not** store access tokens server-side.
- Do **not** store OTP values on `AuthSession`.
- One subject may have **many** concurrent sessions (multiple devices). Never model “one refresh token per user.”
- Logout current session, logout all sessions, and revoke a specific session must be supported by the model.
- Access tokens are short-lived; **revoking refresh sessions** is the primary server-side logout mechanism. Do not introduce a default access-token blacklist.

Indexes/constraints (AUTH-02 / ADM-AUTH-01): unique session id; unique current `refreshTokenHash`; indexes on subject + `revokedAt`, `tokenFamilyId`, and `expiresAt` for both `AuthSession` and `AdminAuthSession`. Refresh lookup must not scan all sessions.

## Access-token strategy

- Short-lived **JWT** signed with **HS256** using `JWT_ACCESS_SECRET`.
- Claims: `sub` (subject id), `subjectType` (`USER` \| `ADMIN`), `sessionId`, `tokenUse=access`, `iat`, `exp`.
- Do not embed phone, profile, address, permissions, refresh material, or secrets. AUTH-08 confirmed this: admin role and permissions are resolved server-side on each authorization decision, not carried as claims ([ADR 0007](../docs/adr/0007-authorization-model.md)).
- Application code uses `AccessTokenService`, not Nest `JwtService` / `jose` directly.
- Session binding: `sessionId` references `AuthSession` for USER tokens and `AdminAuthSession` for ADMIN tokens. Guards verify signature/expiry by default and do **not** hit the database on every request. After revocation, a stolen AT may work until short expiry; refresh/session state stops continuation. No access-token blacklist.
- `AccessTokenService` issues USER and ADMIN access tokens. ADMIN issuance is valid only when `sessionId` is a real `AdminAuthSession` id created at login/refresh. The service does not look up sessions on issue (the read path stays DB-free).

## Refresh-token strategy (opaque)

Refresh tokens are **not JWTs**. Format:

```text
sessionId.secret
```

- `sessionId` is a UUID used only for routing; digests and session state remain authoritative.
- `secret` is 32 cryptographically random bytes (256-bit), base64url-encoded.
- Persist only `SHA-256(base64url)` digest of the **full** raw token via `digestRefreshToken`.
- `RefreshTokenService` issues `{ rawToken, digest, sessionId }` and parses safely without leaking token material in errors.
- No `JWT_REFRESH_SECRET` — opaque tokens are not signed as JWTs.

## Browser access-token transport (AUTH-03 decision)

**Option A (approved product direction):**

```text
Access token  → HttpOnly cookie
Refresh token → HttpOnly cookie
CSRF required for cookie-authenticated state-changing browser requests
```

Rationale: matches the existing EggShip frontend cookie + CSRF model; avoids LocalStorage refresh tokens; keeps tokens out of JavaScript.

**Implementation note (AUTH-04):** `AccessTokenGuard` accepts `eggship_at` and/or Authorization Bearer (conflicting values rejected). Refresh uses only `eggship_rt`. Auth cookie helpers live at the HTTP boundary (`AuthCookieWriter`). CSRF middleware remains a production blocker for browser cookie mutations.

### Cookie policy

| Attribute | Customer                                               | Admin                                                    |
| --------- | ------------------------------------------------------ | -------------------------------------------------------- |
| Names     | `eggship_at` / `eggship_rt`                            | `eggship_admin_at` / `eggship_admin_rt`                  |
| HttpOnly  | required                                               | required                                                 |
| Secure    | required when `NODE_ENV=production`                    | required when `NODE_ENV=production`                      |
| SameSite  | `Lax`; `None`+`Secure` only after explicit review      | same                                                     |
| Path      | `/`                                                    | `/api/v1/admin`                                          |
| Domain    | omit (host-only) unless multi-subdomain needs approved | omit (host-only); production domains are never hardcoded |
| Max-Age   | access TTL / remaining refresh-session lifetime        | same                                                     |
| Clearing  | empty value, `Max-Age=0`, matching attributes          | clears **Admin** cookies only; never User cookies        |

Storefront and Admin may run in the same browser. Namespaced names plus Admin `Path` prevent cookie overwrite regardless of future Liara hostname topology. Do not share `eggship_at` / `eggship_rt` for Admin.

## Token / session config

| Setting               | Env                           | Default                            |
| --------------------- | ----------------------------- | ---------------------------------- |
| Access signing secret | `JWT_ACCESS_SECRET`           | required (≥ 32 chars, non-trivial) |
| Access TTL            | `JWT_ACCESS_TTL` (seconds)    | `900` (15 minutes, configurable)   |
| Refresh session TTL   | `REFRESH_TOKEN_TTL` (seconds) | `2592000` (30 days, configurable)  |

## Refresh-token rotation

Refresh tokens rotate on every successful `POST /api/v1/auth/refresh`:

```text
RT1 → (refresh) → RT2 → (refresh) → RT3
```

- Previous refresh token becomes unusable after rotation.
- The new token is the only active refresh credential for that session/family.
- Rotation uses conditional `updateMany` on current digest + unrevoked + unexpired, and records the previous digest in `AuthRefreshTokenConsumption` in the same transaction.
- Successful refresh updates `lastUsedAt`. Ordinary API requests do not.
- Response body is `{ "data": { "authenticated": true } }` with new cookies; tokens are never returned in JSON.
- Auth session endpoints set `Cache-Control: no-store`.

### Reuse detection

PostgreSQL stores the current digest on `AuthSession` and bounded consumed digests in `AuthRefreshTokenConsumption` (`expiresAt` retention bound for later DATA-02 cleanup; not Redis-authoritative).

```text
reused refresh token (consumed digest outside race grace)
  → revoke all AuthSession rows sharing tokenFamilyId
  → clear auth cookies
  → AUTH_REFRESH_TOKEN_REUSED (401)
  → emit auth.refresh.reuse_detected (warn)
```

Concurrent refresh of the **same current** RT: exactly one rotation succeeds; the loser that hits a digest consumed within `REFRESH_REUSE_RACE_GRACE_MS` (10s), including negative age from request ordering/clock skew, receives `AUTH_INVALID_TOKEN` without family revocation (lost race). Digests older than the grace window are confirmed reuse. HTTP refresh does **not** clear cookies on that race-loser `AUTH_INVALID_TOKEN` so a sibling tab’s winning `Set-Cookie` is not wiped.

**Revocation scope:** token family only (`tokenFamilyId`). Other device sessions (other families) for the same user are not revoked by reuse. `logout-all` revokes every session for that user.

### Logout

| Endpoint                       | Behavior                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `POST /api/v1/auth/logout`     | Optional AT; revoke current session when principal present; always clear cookies; idempotent |
| `POST /api/v1/auth/logout-all` | Requires AT (cookie or Bearer); revoke all user sessions; clear cookies                      |

Access tokens are not blacklisted. After logout, a stolen AT may work until short expiry; refresh continuation is stopped.

### Refresh-token hashing

Refresh tokens are high-entropy secrets. Store a **cryptographic digest** suitable for keyed lookup (for example SHA-256 over the raw token, encoded for storage), **not** Argon2/bcrypt.

- Argon2 is for low-entropy passwords, not high-entropy token lookup.
- Digest helper: `src/modules/auth/domain/refresh-token-digest.ts`.
- Never log raw tokens or digests in application diagnostics unless a future security task explicitly approves truncated fingerprints.

## Session expiry and TTLs

- Refresh-session expiry and access-token TTL are **configuration-driven** (`JWT_ACCESS_TTL`, `REFRESH_TOKEN_TTL`).
- Defaults (900s / 2592000s) are starting points, not immutable product constants. Benchmark and adjust before production hardening.

## Concurrent refresh and logout

### Concurrent refresh

Two requests may present the same refresh token simultaneously. AUTH-04 prevents both from independently succeeding via conditional transactional rotation (digest + unrevoked + unexpired) plus consumed-digest recording.

### Logout vs refresh

Logout (set `revokedAt`) and refresh remain deterministic under concurrency: rotation requires `revokedAt IS NULL`, so a revoked session cannot mint a successor. Final state after logout vs refresh races is a revoked session that cannot continue refreshing.

## Password hashing (Admin)

- Algorithm: **Argon2id** via `PasswordHasher` port (`Argon2PasswordHasher` implementation).
- Baseline parameters (OWASP interactive): memoryCost `19456` KiB (~19 MiB), timeCost `2`, parallelism `1`, hashLength `32`.
- Benchmark on Liara before production hardening; do not log passwords, hashes, or salts.
- `verify` returns `false` for wrong passwords and malformed hashes (no library error leakage).
- Password-reset flows remain out of scope until an explicit task.
- Admin password **login HTTP** is `POST /api/v1/admin/auth/login` (ADM-AUTH-01). Identity creation hashes through the same port; there is no second hashing policy.

### Admin password policy

Length-oriented and adopted for Admin creation/bootstrap (`src/modules/admins/domain/admin-password-policy.ts`): minimum 12 characters, maximum 128, no composition rules. Length is what resists guessing; character-class requirements push operators toward predictable substitutions. The maximum exists to bound Argon2 work per request, not as a security rule.

Login does **not** reject short passwords with a distinct validation error (that would leak policy to attackers); it verifies and returns `AUTH_INVALID_CREDENTIALS`. Policy is enforced at creation/bootstrap before hashing.

Deferred: breached-password corpus rejection and password rotation/expiry (ADM-01 / a later security task). Login throttling is implemented (see Admin login below).

## OTP and Redis split

| Concern                       | Store           |
| ----------------------------- | --------------- |
| Identity, AuthSession, roles  | PostgreSQL      |
| OTP codes / short-lived abuse | Redis (AUTH-05) |
| Rate limits                   | Redis (AUTH-05) |

Redis must **not** be the only authoritative store for long-lived sessions. OTP ephemeral state is Redis-only; durable identity remains PostgreSQL.

## OTP policy (AUTH-05)

Customer storefront authentication uses Iranian mobile OTP. AUTH-05 delivers approved policy plus application/infrastructure primitives (`OtpService`). AUTH-06 exposes public HTTP request/verify. Registration/session issuance is AUTH-07+.

### Format and generation

- Exactly **six numeric digits** (`000000`–`999999`), leading zeros allowed.
- Production generation uses CSPRNG (`crypto.randomInt`); never `Math.random()`.
- Purpose binding: `customer_auth` on each challenge (identity-neutral login/registration entry path).

### Challenge identity

- Verification uses **`challengeId` + code** (not phone alone).
- Challenge IDs are UUIDs. Redis keys are namespaced (`eggship:auth:otp:v1:…`) and must not appear in unrestricted logs.
- Canonical phone is stored on the challenge and copied into the verification grant after successful verify.

### Storage / digest

- Redis stores an **HMAC-SHA256** digest of the OTP keyed with `OTP_HASH_SECRET`, not the plaintext code.
- Threat model: six-digit entropy is low; HMAC binds digests to the deployment secret so Redis dumps are not reusable across deployments. Attempt limits + short TTL remain primary online defenses. Never log digests or codes.

### Lifecycle

| Event            | Behavior                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Request          | Peek cooldown (no window charge) → rate-limit windows → create challenge + cooldown → send SMS |
| Delivery failure | Delete challenge; keep cooldown; return `AUTH_OTP_DELIVERY_FAILED`                             |
| Verify success   | Atomically consume once and mint verification grant in one Redis Lua script                    |
| Verify failure   | Atomic attempt increment; lock/delete at max attempts                                          |
| Expiry           | Challenge TTL; expired consume returns `AUTH_OTP_EXPIRED`                                      |
| Redis key grace  | Challenge/grant Redis `EXPIRE` is logical TTL + 60s so `expired` is observable before eviction |
| Resend           | Cooldown SET NX per phone; replacement deletes prior active challenge                          |
| Redis outage     | OTP operations fail with `AUTH_OTP_UNAVAILABLE`; no in-memory fallback                         |

### Initial configurable defaults (not immutable product constants)

| Setting                    | Env                                  | Default     | Notes                                |
| -------------------------- | ------------------------------------ | ----------- | ------------------------------------ |
| Challenge TTL              | `OTP_TTL_SECONDS`                    | `300`       | Max `900`                            |
| Max wrong attempts         | `OTP_MAX_ATTEMPTS`                   | `5`         | Max `20`                             |
| Resend cooldown            | `OTP_RESEND_COOLDOWN_SECONDS`        | `60`        | Max `600`                            |
| Phone request window/limit | `OTP_PHONE_WINDOW_*`                 | `3600`/`5`  | Abuse / SMS cost                     |
| IP request window/limit    | `OTP_IP_WINDOW_*`                    | `3600`/`20` | Requires trusted request IP (deploy) |
| Verification grant TTL     | `OTP_VERIFICATION_GRANT_TTL_SECONDS` | `600`       | Max `900`; AUTH-06 handoff           |

### Provider abstraction

```text
OtpService → OtpCodeIssuer + OtpStore(Redis) + SmsProvider + OtpVerificationGrantStore(Redis)
SmsProvider → DevelopmentSmsProvider | KavenegarSmsProvider
```

- Auth must not import a Kavenegar SDK. Adapter uses documented `verify/lookup.json` (`receptor`, `token`, `template`).
- `OTP_PROVIDER=development` + `OTP_DEV_CODE` (default `111111`): issuer returns configured code; SMS is a no-op. **Never** implement `if code === "111111"` in generic verification. **Never** return the development code in HTTP responses.
- `NODE_ENV=production` **rejects** `OTP_PROVIDER=development` at startup.
- Staging deployments that use `NODE_ENV=production` must use `kavenegar` with staging credentials.
- Live Kavenegar smoke tests are pending account credentials; unit tests use a fake HTTP transport. Missing Kavenegar config when `OTP_PROVIDER=kavenegar` fails at startup validation.

### Enumeration and errors

OTP request/verify must not reveal whether a phone already has a User row. AUTH-06 does not query User persistence to customize public behavior. Stable codes:

```text
AUTH_OTP_COOLDOWN
AUTH_OTP_RATE_LIMITED
AUTH_OTP_INVALID
AUTH_OTP_EXPIRED
AUTH_OTP_TOO_MANY_ATTEMPTS
AUTH_OTP_ALREADY_USED
AUTH_OTP_DELIVERY_FAILED
AUTH_OTP_UNAVAILABLE
```

HTTP mapping: cooldown/rate-limit → `429` (with `Retry-After` when `retryAfterSeconds` is present); delivery/unavailable → `503`; invalid/expired/locked/already-used → `401`. Wrong-code and validation failures are not `500`.

### Observability

Emit `auth.otp.request.succeeded`, `auth.otp.request.rejected`, `auth.otp.verify.succeeded`, `auth.otp.verify.rejected` with `challengeId` / `verificationGrantId` and safe reason fields only. Never log OTP, phone, Redis keys, API keys, or provider response bodies. Expected wrong-code events are info-level; provider outages are error-level.

### IP / request source

Abuse limits may use a trusted client IP supplied by the HTTP boundary via `resolveOtpRequestSource`:

- Uses Express/`req.ip` (and socket `remoteAddress` fallback) only.
- Does **not** parse `X-Forwarded-For` directly.
- Behind a reverse proxy (including future Liara), configure Nest/Express **trust proxy** so `req.ip` is the trusted client address. Until that deployment setting is approved, the resolved IP may be the immediate peer; phone-level limits remain enforced.
- When no trustworthy IP can be derived, omit `clientIp` rather than inventing one from untrusted headers.

## OTP HTTP contract (AUTH-06)

```http
POST /api/v1/auth/otp/request
POST /api/v1/auth/otp/verify
```

OpenAPI operation IDs: `Auth_requestOtp`, `Auth_verifyOtp`. Tag: `Auth`.

### Request OTP

Body: `{ "phone": "<supported Iranian mobile input>" }` (unknown fields rejected). Phone is normalized with `normalizeIranianPhone` to `+989…`.

Success (`200`, `Cache-Control: no-store`):

```json
{
  "data": {
    "challengeId": "<uuid>",
    "expiresInSeconds": 300,
    "resendAfterSeconds": 60
  }
}
```

No authentication cookie required. No session/AT/RT issued. OTP code is never returned.

### Verify OTP

Body: `{ "challengeId": "<uuid>", "code": "<exactly six ASCII digits>" }` (whitespace-padded codes rejected at the DTO boundary; unknown fields rejected).

Success (`200`, `Cache-Control: no-store`):

```json
{
  "data": {
    "verificationGrantId": "<uuid>",
    "expiresInSeconds": 600,
    "purpose": "customer_auth"
  }
}
```

Canonical phone is **not** returned. No session is issued.

### Verification grant handoff

See [ADR 0005](../docs/adr/0005-otp-verification-grant.md). Successful verify mints a Redis grant that is:

- short-lived (`OTP_VERIFICATION_GRANT_TTL_SECONDS`)
- single-use (atomic consume)
- bound to canonical phone + `customer_auth` purpose
- not forgeable from an arbitrary challenge id alone
- consumed server-side by AUTH-07+ (`OtpService.consumeVerificationGrant`)

Do not treat `{ "verified": true }` or a bare challenge id as proof.

### CSRF

OTP request/verify are pre-authentication and do not mutate authenticated cookie session state. Protect them with strict validation, phone/IP abuse controls, and Redis atomicity. Do not apply authenticated-cookie CSRF requirements to these anonymous endpoints.

### Cache and retry metadata

OTP responses set `Cache-Control: no-store`. Cooldown/rate-limit errors include `error.details.retryAfterSeconds` and set the HTTP `Retry-After` header consistently.

## Customer auth completion (AUTH-07)

Unified storefront authentication after OTP verify. The frontend does **not** choose login vs register before authentication.

### Flow decision (Pattern A)

```text
OTP verified → verificationGrantId
  → consume grant (Redis, single-use)
  → find User by grant phone
  → missing → create User (phone identity only)
  → existing → authenticate
  → reject if isActive = false
  → create AuthSession + AT/RT cookies
```

Business profile fields (store name, manager name, address, region, coordinates) are **not** collected at registration in AUTH-07. No in-repository legacy field inventory exists yet (`MIG-01` still PLANNED). Auth must not invent speculative profile columns. `profileComplete` is `true` for phone-only identity completeness and will be revised when evidenced business fields land.

Region **reference** persistence and Admin/public list APIs exist as of CAT-02 (`instructions/catalog.md`). Customer profile `regionId` FK remains deferred until profile fields are evidenced; do not invent the FK here. Referral attribution is out of scope.

### HTTP

```http
POST /api/v1/auth/complete
GET  /api/v1/auth/me
PATCH /api/v1/users/me
```

OpenAPI operation IDs: `Auth_complete`, `Auth_me`, `Users_updateMe`.

#### Complete authentication

Body: `{ "verificationGrantId": "<uuid>" }` (unknown fields rejected; **no phone field**).

Success (`200`, `Cache-Control: no-store`, Set-Cookie `eggship_at` / `eggship_rt`):

```json
{
  "data": {
    "authenticated": true,
    "isNewUser": true,
    "profileComplete": true,
    "user": { "id": "<uuid>" }
  }
}
```

Tokens are never returned in JSON. Multiple device sessions remain supported; normal completion does not revoke prior sessions.

CSRF: pre-authentication grant consumption — do not require authenticated-cookie CSRF on `POST /auth/complete`. After cookies are set, future cookie-authenticated mutations still require CSRF (AUTH-04 production blocker unchanged).

#### Current user

`GET /api/v1/auth/me` requires AT (cookie or Bearer). Returns safe identity DTO (`id`, `phone`, `isActive`, `profileComplete`, timestamps). Inactive accounts → `AUTH_ACCOUNT_DISABLED`.

#### Profile update

`PATCH /api/v1/users/me` derives the target exclusively from the authenticated principal. AUTH-07 allowlist has **no mutable business fields** yet; empty body is valid; unknown properties are rejected. Never mutate `id`, phone, `isActive`, or security fields via this endpoint. Phone change is a future verified operation.

Profile address (when added later) is mutable current state. Future Orders capture immutable shipping snapshots and must not be rewritten by later profile edits.

### Grant consumption (ADR 0006)

Consume-first: Redis grant is atomically consumed before PostgreSQL User/session work. Concurrent same-grant completions yield exactly one success. Persistence failure after consume requires a new OTP (grant is not replayable). Same-phone concurrent registrations rely on `User.phone` uniqueness + P2002 handling (loser authenticates the existing row when active). No separate idempotency table for AUTH-07 — the grant is the completion key.

### Additional Auth error codes

```text
AUTH_VERIFICATION_GRANT_INVALID
AUTH_VERIFICATION_GRANT_EXPIRED
AUTH_VERIFICATION_GRANT_USED
AUTH_REGISTRATION_CONFLICT
AUTH_ACCOUNT_DISABLED
```

HTTP: grant failures → `401`; disabled account → `403`; registration conflict → `409`.

### Observability

Emit `auth.customer.authenticated`, `auth.customer.registered`, `auth.customer.authentication_rejected`, and `user.profile.updated` with `subjectId` / `sessionId` only — never phone, address, tokens, or grant ids.

## Admin authentication (ADM-AUTH-01)

```http
POST /api/v1/admin/auth/login
GET  /api/v1/admin/auth/me
POST /api/v1/admin/auth/refresh
POST /api/v1/admin/auth/logout
POST /api/v1/admin/auth/logout-all
```

OpenAPI operation IDs: `AdminAuth_login`, `AdminAuth_me`, `AdminAuth_refresh`, `AdminAuth_logout`, `AdminAuth_logoutAll`. Tag: `AdminAuth`.

Login identifier is canonical email. Unknown email, wrong password, and uncanonicalizable identifiers that pass body validation return `AUTH_INVALID_CREDENTIALS` (401) with the same public message. A body that fails class-validator (empty password, email shorter than 3 characters, oversize fields) is `BAD_REQUEST` (400) as malformed input, not an account-existence oracle. After a successful password verify, an inactive Admin returns `AUTH_ACCOUNT_DISABLED` (403) — identity is proven, matching customer complete-auth. Do not return `ADMIN_EMAIL_NOT_FOUND` or `WRONG_ADMIN_PASSWORD`.

**Timing:** a process-start dummy Argon2id hash (one random password hashed at `onModuleInit`, never per request) is verified when the Admin is missing so unknown-email and wrong-password pay similar Argon2 cost. Do not invent custom timing crypto.

**Throttling:** per email-fingerprint and per request-source IP fixed windows (900s / 5 email, 900s / 20 IP). Redis when configured; in-process memory in development/test; production without Redis fails closed (`AUTH_UNAVAILABLE`). Exceeded windows return `AUTH_RATE_LIMITED` (429) with `Retry-After`. Email is HMAC-fingerprinted with `OTP_HASH_SECRET`; never logged.

Refresh/logout use **only** Admin cookies and `AdminAuthSession`. A User refresh token cannot resolve as Admin (fail closed). Logout-all revokes that Admin's sessions only.

`GET /admin/auth/me` returns `id`, `email`, `role`. `role` is display-only; authorization still resolves permissions per request via `ADMIN_ROLE_RESOLVER`. USER subject → `AUTH_FORBIDDEN` (403). Inactive Admin → `AUTH_ACCOUNT_DISABLED`. Never return `passwordHash`.

Auth-lifecycle Admin routes do not use `PermissionGuard`. Permissioned Admin APIs (ADM-01 / CAT-05) still owe both guards.

### First SUPER_ADMIN provisioning

`pnpm admin:create` is the explicit operator command. It never runs at app startup, never defaults an omitted role, never prints the password afterwards, and never creates a known credential. The Nest entry boots `AdminCreateCliModule` (Prisma + hasher + Admin identity only), not the full HTTP/Redis/OTP application.

- Email: `--email` or `EGGSHIP_ADMIN_CREATE_EMAIL`
- Role: `--role` or `EGGSHIP_ADMIN_CREATE_ROLE` (must be a known `AdminRole`; no default)
- Password: hidden TTY prompt, or `EGGSHIP_ADMIN_CREATE_PASSWORD` for automation. Do not pass the password as a CLI flag. Do not read `JWT_ACCESS_SECRET` or other app secrets as the password.
- Target database: prints a masked `DATABASE_URL` identity (no password). Development/test requires `EGGSHIP_ADMIN_CREATE_CONFIRM=yes`. Production requires `EGGSHIP_ADMIN_CREATE_CONFIRM=I_UNDERSTAND_PRODUCTION:<db-host>`. Hostnames are never used to guess production.

Duplicate canonical email is refused. General Admin CRUD HTTP remains `ADM-01`.

## Account enumeration

Public Auth responses must not distinguish “unknown phone/user” from “known but invalid credential/OTP” where that would enable account enumeration, unless a later security review approves a deliberate exception for a specific flow. Prefer identical timing and generic `AUTH_INVALID_CREDENTIALS` (or OTP-equivalent) codes for failed login attempts. Exact OTP enumeration policy is refined in AUTH-05/06.

## Domain errors

Auth application/domain code throws typed domain failures with stable codes. HTTP mapping belongs at the API boundary / global filter—not inside domain services.

Reserved codes (implement mapping when flows land):

```text
AUTH_INVALID_CREDENTIALS
AUTH_SESSION_EXPIRED
AUTH_SESSION_REVOKED
AUTH_REFRESH_TOKEN_REUSED
AUTH_REFRESH_TOKEN_MISSING
AUTH_INVALID_TOKEN
AUTH_TOKEN_EXPIRED
AUTH_ACCOUNT_DISABLED
AUTH_UNAUTHENTICATED
AUTH_FORBIDDEN
AUTH_RATE_LIMITED
AUTH_UNAVAILABLE
AUTH_VERIFICATION_GRANT_INVALID
AUTH_VERIFICATION_GRANT_EXPIRED
AUTH_VERIFICATION_GRANT_USED
AUTH_REGISTRATION_CONFLICT
AUTH_OTP_COOLDOWN
AUTH_OTP_RATE_LIMITED
AUTH_OTP_INVALID
AUTH_OTP_EXPIRED
AUTH_OTP_TOO_MANY_ATTEMPTS
AUTH_OTP_ALREADY_USED
AUTH_OTP_DELIVERY_FAILED
AUTH_OTP_UNAVAILABLE
```

Do not throw Nest `HttpException` from domain logic.

## Security logging

Emit structured security-relevant events for future flows (reuse, OTP failures, admin login failures, session revocation, permission denial) with `module` / `operation` and safe identifiers (`sessionId`, `subjectType`, subject id)—never:

```text
raw access token
raw refresh token
OTP
password
Cookie
Authorization header
```

Do not place authentication secrets or PII into generic request context ([observability.md](observability.md)).

## Persistence deferred to AUTH-02

AUTH-01 does **not** create Prisma models or migrations. AUTH-02 must add User, Admin (or equivalent), AuthSession/token-family, credential, uniqueness, and index constraints consistent with this policy.

## Persistence (AUTH-02)

PostgreSQL is authoritative for identity and long-lived refresh sessions.

| Model                              | Purpose                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `User`                             | Customer/store identity: UUID `id`, unique canonical `phone`, `isActive`                               |
| `Admin`                            | Back-office operator identity: UUID `id`, unique canonical `email`, `passwordHash`, `role`, `isActive` |
| `AuthSession`                      | User refresh sessions only                                                                             |
| `AuthRefreshTokenConsumption`      | Bounded consumed User refresh digests (AUTH-04); cleanup later via DATA-02                             |
| `AdminAuthSession`                 | Admin refresh sessions only (ADM-AUTH-01 / ADR 0009)                                                   |
| `AdminAuthRefreshTokenConsumption` | Bounded consumed Admin refresh digests; not referenced by User consumption                             |

Concrete rules:

- Phone storage is canonical E.164 only (`+989…`); a CHECK constraint rejects other shapes.
- Prefer `isActive = false` over hard-deleting users. `AuthSession.userId` uses `ON DELETE RESTRICT` so sessions cannot become orphans via casual user CASCADE deletes.
- Multiple `AuthSession` rows per `userId` are required (devices).
- Store only the current refresh-token SHA-256 digest (`VarChar(43)` base64url), globally unique for deterministic lookup and collision defense.
- Each session has a UUID `tokenFamilyId` for rotation/reuse detection; logout sets `revokedAt` and retains the row.
- Session expiry is an explicit `expiresAt` timestamptz; TTLs are application/config concerns, not schema defaults.
- Refresh rotation must use conditional updates (`refreshTokenHash` + unrevoked + unexpired). Repository primitive: `AuthSessionRepository.rotateRefreshTokenHash`.
- `AuthSession.userId` stays a non-nullable FK to `User`. Admin sessions attach through `AdminAuthSession.adminId` (`ON DELETE RESTRICT`). A User consumption row never references an Admin session.
- Multiple `AdminAuthSession` rows per `adminId` are required (devices).

Indexes: unique `phone`; unique `email` on `Admin`; unique `refreshTokenHash`; `(userId, revokedAt)`; `tokenFamilyId`; `expiresAt`.

## Threat model (summary)

| Threat                         | Mitigation direction                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| Stolen long-lived bearer AT    | Short AT TTL; prefer HttpOnly cookies for browsers                          |
| XSS steals refresh token       | HttpOnly cookies; no LocalStorage refresh tokens                            |
| CSRF on cookie session         | CSRF protection for state-changing browser requests                         |
| Refresh token theft / replay   | Rotation + reuse detection + family revocation                              |
| Concurrent refresh split-brain | Conditional transactional rotation                                          |
| Password stuffing (admin)      | Argon2id, Redis/in-process login windows, generic errors, dummy-hash timing |
| OTP abuse                      | Redis rate limits / AUTH-05 (cooldown, windows, attempts)                   |
| Cross-subject privilege mix    | Separate User/Admin identities and `subjectType` claims                     |
| Secret leakage in logs         | Central redaction + Auth logging rules                                      |
| Production OTP backdoor        | Development provider forbidden when NODE_ENV=production                     |

## Unresolved Auth details (explicit)

These remain open for later Auth / frontend tasks; do not treat them as implemented:

1. CSRF token mechanism details (double-submit vs synchronizer), header name, and middleware (production blocker for browser cookie mutations, including Admin cookie auth).
2. Final numeric TTL values after product/load confirmation.
3. Breached-password corpus rejection and Admin password rotation/expiry.
4. Automatic Admin session revocation when `ADM-01` disables an Admin or changes a security-sensitive role (required for ADM-01; not implemented in ADM-AUTH-01).
5. Live Kavenegar credential smoke test when account access exists.
6. Legacy EggShip auth inventory reconciliation (MIG-01).
7. Cross-site `SameSite=None` only if a future origin matrix requires it.
8. Deployment-time Nest/Express `trust proxy` configuration so OTP and Admin-login IP rate limits see the real client behind Liara (or other reverse proxies). Until configured, `resolveOtpRequestSource` uses the immediate Express-resolved peer only.
