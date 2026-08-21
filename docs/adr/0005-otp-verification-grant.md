# ADR 0005: OTP verification grant handoff

## Status

Accepted

## Context

AUTH-06 exposes public OTP request/verify HTTP endpoints without issuing AuthSession access/refresh cookies. Registration and customer login (AUTH-07+) still need a server-side proof that OTP verification succeeded for a specific canonical phone and purpose. Returning `{ "verified": true }` (or echoing the challenge id) would be forgeable or replayable by clients.

## Decision

On successful OTP verify, Redis Lua **atomically** consumes the OTP challenge and mints a **short-lived, single-use verification grant** in the same script, bound to:

- canonical phone
- purpose (`customer_auth`)
- originating `challengeId`

The challenge is never marked consumed unless the grant hash + TTL are written in that same script. Clients receive only `verificationGrantId` (and expiry/purpose metadata). Canonical phone is not returned. Later Auth tasks consume the grant server-side via `OtpService.consumeVerificationGrant`; concurrent consumers yield exactly one success. Grants are ephemeral Redis state, not sessions, JWTs, or cookies.

Default TTL is `OTP_VERIFICATION_GRANT_TTL_SECONDS` (600s, max 900s).

## Consequences

AUTH-07+ must consume the grant inside registration/login orchestration rather than trusting client assertions. OTP HTTP remains enumeration-safe and session-free. Redis outages fail OTP/grant operations closed (`AUTH_OTP_UNAVAILABLE`). Redis→PostgreSQL session handoff ordering is defined in [ADR 0006](./0006-verification-grant-session-handoff.md).
