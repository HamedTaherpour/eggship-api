# Frontend error consumption

Admin and Storefront clients must branch on `error.code`, never on
`error.message`. The backend message is Persian, safe, and suitable for direct
display only when the code represents an intentional user-facing outcome.
Clients should not maintain a duplicate translation catalog by default.

## Behavior

- `AUTH_TOKEN_EXPIRED`: refresh once, retry the original request once, then
  clear the session if refresh fails. Do not create a refresh loop.
- `AUTH_SESSION_EXPIRED`, `AUTH_SESSION_REVOKED`, and
  `AUTH_REFRESH_TOKEN_REUSED`: clear the session and redirect to login.
- `AUTH_FORBIDDEN`: keep the session and show an access-denied state.
- `AUTH_RATE_LIMITED`, `AUTH_OTP_RATE_LIMITED`, and cooldown errors: honor
  `Retry-After` or `error.details.retryAfterSeconds`; do not poll aggressively.
- `VALIDATION_ERROR`: map each `details.violations[]` entry by its structural
  `field` path. Use `rule` for stable field behavior and treat `message` as
  display copy; never parse it.
- `INTERNAL_ERROR`: show a generic retry/support state and provide `requestId`
  to support. Do not display internal details or retry unsafe mutations blindly.

For `403`, `404`, `409`, `429`, and `503`, branch on the code/status and use the
backend message as fallback display copy. `requestId` identifies the request
for diagnostics; it is not an authorization or retry token.

Only documented safe details may be consumed, such as retry delays,
validation violations, and explicitly documented conflict or range metadata.
Unknown details must be ignored.

Error codes are stable contract identifiers after API-ERR-01. They must not be
renamed casually; a breaking rename requires compatibility review and OpenAPI
and client impact analysis.
