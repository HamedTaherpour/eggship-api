# ADR 0006: Verification-grant to session handoff

## Status

Accepted

## Context

AUTH-07 completes customer authentication by consuming a Redis OTP verification grant (ADR 0005) and creating PostgreSQL `User` / `AuthSession` rows plus HttpOnly auth cookies. Redis and PostgreSQL cannot share a native ACID transaction. Ordering matters for abuse safety and user retry behavior:

- Consume grant after PostgreSQL success risks replay if cookies are issued twice before consume.
- Consume grant before PostgreSQL success risks forcing another OTP when persistence fails after consume.
- Concurrent completion with the same grant must not mint many sessions.

## Decision

Use **consume-first** handoff:

1. Atomically consume the verification grant in Redis (single-use; concurrent consumers yield one success).
2. Derive canonical phone and purpose only from the grant record (never trust client phone).
3. In PostgreSQL, find-or-create the `User` by phone (unique constraint + P2002 race handling) and create exactly one `AuthSession` for the winning request.
4. Issue access/refresh tokens and set cookies at the HTTP boundary.

Do **not** introduce a second generic idempotency subsystem for AUTH-07. The single-use grant is the completion idempotency key.

Failure/retry:

- If Redis consume fails → stable grant error; no session.
- If PostgreSQL fails after consume → grant is already spent; client must request and verify a new OTP. Prefer this over allowing grant replay.
- Same grant, concurrent completes → exactly one logical authentication completion; losers receive `AUTH_VERIFICATION_GRANT_USED` (or equivalent used/invalid grant failure).
- Same phone, two distinct grants racing registration → at most one `User`; the loser of `User.phone` uniqueness loads the winner and authenticates as an existing user when active.

## Consequences

AUTH-07 documents Pattern A (OTP → identity User → session; business profile fields deferred until evidenced). Operators and clients must treat post-consume persistence failures as “restart OTP,” not “replay grant.” CSRF remains required before production browser cookie mutations (AUTH-04 blocker unchanged).
