# Observability

EggShip observability is provider-independent. Application code writes structured events through `ApplicationLogger`; it must not depend directly on Pino, a transport, or an external monitoring vendor. Do not use `console.log`, `console.error`, or related console methods in application code.

## Structured logging

- Include `module` and `operation` on application events. Add only fields relevant to the event.
- Root logs include `service`, environment (`NODE_ENV`), application version, and Git SHA (`APP_VERSION` / `GIT_SHA` from the build; see [releases](releases.md) and [environment](environment.md)).
- HTTP completion events include method, path without query values, status, duration, request ID, and correlation ID.
- Do not log request or response bodies by default. Never serialize large payloads for convenience.
- Log expected validation/application failures at a lower severity than unexpected operational failures. Unexpected failures are logged once at error level with a safe internal stack and remain sanitized in API responses. Expected Admin credential rejections use `admin.auth.login.rejected` / `admin.auth.refresh.rejected` at info; reuse detection uses `admin.auth.refresh.reuse_detected` at warn. Successful Admin auth uses `admin.auth.login.succeeded`, `admin.auth.refresh.succeeded`, and `admin.auth.session.revoked` (no email, password, hash, token, or digest).
- Never log complete `DATABASE_URL`, `REDIS_URL`, passwords, tokens, or other credentials. When a connection target must be identified, use masked host metadata only.

## Context and identifiers

- Every HTTP request receives a collision-resistant request ID. Only bounded IDs matching the approved syntax may be accepted from `X-Request-Id`; all other values are replaced.
- Return the final ID in the `X-Request-Id` response header. Error bodies use the same value.
- HTTP correlation IDs default to the request ID.
- Use `RequestContextService` instead of manually threading IDs through controllers and services.
- Future asynchronous jobs and outbox messages must carry `correlationId` explicitly and establish a new application context when consumed. Do not store authentication data or PII in generic request context.

## Redaction and privacy

Central redaction protects authorization and cookie headers, tokens, OTPs, passwords, secrets, API keys, database URLs/credentials, emails, phone numbers, and addresses. Redaction is defense in depth, not permission to log sensitive objects.

Personal information must not be casually logged in production. A justified diagnostic must use an explicitly masked representation and document why it is necessary. Never log `Authorization`, `Cookie`, `Set-Cookie`, raw request/response bodies, access or refresh tokens, OTP values, passwords, secrets, or database connection strings.

## Diagnostic bundles

A future diagnostic bundle may contain request and correlation IDs, timestamp, endpoint or operation, safe error code, application version, and Git SHA. It must exclude secrets, credentials, request/response bodies, infrastructure connection details, and PII. Do not add diagnostic endpoints or an Admin UI without a separately approved design and authorization model.
