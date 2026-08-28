# ADR 0019: CSRF architecture for browser mutations

Status: Accepted by AUTH-09 architecture review

## Context

EggShip authenticates storefront customers and Admins with ambient HttpOnly
cookies. The customer cookies are `eggship_at` / `eggship_rt`; Admin cookies are
`eggship_admin_at` / `eggship_admin_rt` and are scoped to
`/api/v1/admin`. The API also accepts an explicit `Authorization: Bearer`
access token for tooling and future non-browser clients. CSRF middleware is not
yet implemented; this ADR locks the contract for AUTH-10.

## Threat model

A hostile site can cause a victim's browser to submit a form or credentialed
request to EggShip while the browser automatically attaches an authenticated
cookie. This can create or cancel a customer Order, change a profile, rotate a
session, log out a customer or Admin, or perform any Admin catalog, pricing,
inventory, media, commerce-policy, order-transition, or settlement mutation.
Login also has a login-CSRF variant: an attacker may try to make a victim's
browser establish the attacker's account, so browser credential-establishing
POSTs are protected even before an authenticated cookie exists.

SameSite=Lax blocks many cross-site subrequests, but it is not the sole
security boundary: navigation behavior, future cross-site topology, browser
differences, and any approved SameSite=None deployment must not turn a cookie
mutation into an unprotected operation. CORS controls whether a script may
read a response; it does not stop a cross-site form or other state-changing
request. XSS is a separate, higher-impact problem: a script running in an
allowed origin can read a non-HttpOnly CSRF cookie and issue valid requests;
CSRF controls do not replace output encoding, CSP, or XSS prevention.

## Decision

V1 uses one shared **signed double-submit cookie** design for customer and
Admin browser clients, combined with strict Origin/Referer validation and
Fetch Metadata checks as defense-in-depth.

The CSRF cookie contains a cryptographically random nonce and a server MAC over
the nonce (for example, `nonce.mac`, encoded with a URL-safe alphabet). The
server never stores the token. It validates the cookie and request header with
constant-time MAC comparison and requires the header value to equal the cookie
value. A random nonce must provide at least 256 bits of entropy. The MAC key is
a dedicated typed secret, distinct from JWT and OTP secrets. This is stateless,
works across horizontally scaled NestJS instances, and needs neither Redis nor
PostgreSQL persistence.

The browser obtains a token from a safe `GET` CSRF bootstrap endpoint in each
cookie namespace. The cookie is readable by the first-party browser client;
authentication cookies remain HttpOnly. The follow-up task owns the exact
endpoint wiring and OpenAPI entries, but must not expose the MAC key or return
authentication tokens in JSON.

Origin validation is mandatory for protected browser requests. `Origin` is
preferred; when absent, a strict same-origin `Referer` URL may be used. A
missing/invalid Origin and missing Referer fallback fail closed in production.
`Sec-Fetch-Site` values `cross-site` and, where policy cannot establish a
trusted same-site relationship, `none` are rejected for mutation requests;
Fetch Metadata is not the sole control because clients may omit it.

Synchronizer tokens were rejected because they require server-side state and
cross-instance storage. An unsigned double-submit cookie was rejected because
an attacker who can set or inject a cookie could forge the matching value.
Origin/Referer alone and SameSite alone were rejected as insufficient primary
controls. CORS remains a separate explicit allowlist.

## Browser contract

| Item              | V1 contract                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie            | `eggship_csrf` for storefront; `eggship_admin_csrf` for Admin                                                                                     |
| Cookie value      | `base64url(random 32-byte nonce).base64url(HMAC-SHA-256(key, namespace + ":" + nonce))`                                                           |
| Cookie visibility | Not HttpOnly; host-only; never a Domain cookie by default                                                                                         |
| Cookie path       | `/` customer; `/api/v1/admin` Admin                                                                                                               |
| Request header    | `X-CSRF-Token` containing the complete cookie value                                                                                               |
| Cookie attributes | `Secure` in production, `SameSite=Lax`, explicit path, no Domain                                                                                  |
| Lifetime          | Random token may be reused while the browser session lasts; rotate on login and logout/login boundaries, and when the cookie is absent or invalid |
| Refresh           | Access/refresh rotation does not require token persistence or invalidate the CSRF secret; the browser keeps the current CSRF cookie/header pair   |
| Failure           | `403` with safe structured `CSRF_TOKEN_MISSING`, `CSRF_TOKEN_INVALID`, or `CSRF_ORIGIN_INVALID`; never reveal MAC or comparison details           |

Customer and Admin names are separate so one browser namespace cannot satisfy
the other. The follow-up may consolidate public error handling to one generic
CSRF code if doing so reduces oracle value, but must keep the documented stable
contract and safe messages.

## Enforcement boundary and route inventory

AUTH-10 must install a centralized global middleware/guard boundary in the
HTTP layer, before controller mutation handlers. Protection is default-on for
unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`; future unsafe methods included)
on browser-capable routes. Exemptions are explicit metadata or a narrowly
reviewed route policy, not controller authors remembering to call a service.
The boundary must determine transport first: an explicit Bearer request that
does not use an auth cookie follows the non-browser/token path and is not forced
through browser CSRF; a request that presents an auth cookie remains protected.
Conflicting cookie/Bearer authentication continues to fail through the existing
auth contract.

Current routes are classified as follows:

### A — CSRF-protected browser mutations

- Customer: `POST /auth/otp/request`, `POST /auth/otp/verify`,
  `POST /auth/complete`, `POST /auth/refresh`, `POST /auth/logout`,
  `POST /auth/logout-all`, `PATCH /users/me`, `POST /orders`, and
  `POST /orders/:id/cancel`.
- Admin: `POST /admin/auth/login`, `POST /admin/auth/refresh`,
  `POST /admin/auth/logout`, `POST /admin/auth/logout-all`.
- Admin business mutations: category and region `POST`/`PATCH`; product
  `POST`/`PATCH`; pricing `PATCH`; discount `POST`/`PATCH` and
  activate/deactivate; inventory receive/adjust; media upload/delete;
  commerce-policy initialize/settings/override `POST`/`PUT`/`DELETE`; order
  confirm/cancel/ship/deliver; and settlement create/change-due-date/receipt/
  settle.

OTP and login are not authenticated-cookie CSRF cases, but remain protected in
the browser contract to prevent login CSRF and cross-site credential/abuse
submission. They are not exemptions from the centralized browser mutation
boundary.

### B — Intentional exemptions

Only safe CSRF bootstrap/token issuance endpoints are exempt because they are
`GET` requests and do not mutate authenticated state. No current unsafe route
is exempt. A future exemption requires named metadata, a threat-model reason,
and security review.

### C — Read-only / no CSRF required

All current `GET` routes: health, public categories/regions/products, customer
and Admin reads, `auth/me`, `admin/auth/me`, order reads, inventory diagnostics,
price history, media reads, settlement reads, and commerce-policy reads. Their
authentication and authorization requirements remain unchanged.

### D — Explicit credential/token transport

Bearer-authenticated tooling and future native requests are not browser ambient
cookie requests and do not require CSRF. The existing refresh endpoints are
cookie-only; a React Native refresh/logout transport must be designed as a
separate explicit-credential contract before mobile auth is implemented. AUTH-10
must not weaken browser enforcement to accommodate it.

Authentication/authorization ordering is: parse request and transport, reject
invalid browser Origin/Fetch Metadata or CSRF before the mutation handler,
then run existing authentication and authorization. The implementation must
preserve the repository's established 401/403 distinction; CSRF failures are
403 and must not disclose whether authentication would have succeeded.

## Origin policy and deployment

Allowed storefront and Admin origins are typed configuration, supplied by
environment/deployment configuration (for example a validated
`CSRF_ALLOWED_ORIGINS` list or equivalent structured settings), never business
code or hard-coded Liara domains. Production requires explicit non-empty
allowlists for both browser surfaces; subdomains are not implicitly trusted.
Local development permits explicitly configured localhost origins and ports.
Tests use synthetic configured origins. Invalid origins, malformed origins,
and production requests with neither valid Origin nor accepted Referer fail
closed. A Liara deployment must configure Express `trust proxy` according to
the actual proxy hop count before any scheme/host-derived fallback is used;
forwarded headers from an untrusted client are not authority.

CORS uses the same reviewed origin inventory where appropriate, but remains a
separate concern: credentialed CORS is explicit and never `*`. Passing CORS
does not satisfy CSRF, and failing CORS is not relied upon as CSRF protection.

## Native-client boundary

React Native must use explicit credentials (for example an Authorization
Bearer access token plus a separately specified refresh credential) and must
not receive or depend on browser cookies. Native clients are not granted an
Origin/CSRF bypass when they use cookies. No mobile authentication is
implemented by AUTH-09 or AUTH-10.

## Security invariants and follow-up requirements

- Every current and future unsafe browser route is protected by default.
- A browser mutation cannot succeed with a missing, malformed, mismatched, or
  forged token, or an invalid/missing production origin.
- Customer and Admin cookie namespaces cannot cross-satisfy CSRF validation.
- Secrets, tokens, cookies, MACs, and comparison details are never logged.
- SameSite, CORS, Fetch Metadata, and CSRF are defense layers with distinct
  responsibilities.
- AUTH-10 must add typed configuration, bootstrap/validation, centralized
  enforcement, explicit route metadata, OpenAPI documentation, unit tests,
  E2E cross-site tests, customer/Admin coverage, and regression tests.
- Cookie-authenticated browser mutation APIs are not production-ready until
  AUTH-10 is complete and its release gate passes.

## Consequences

The design is stateless and horizontally scalable, but browser clients must
read a CSRF cookie and send the matching header, and deployments must maintain
accurate origin configuration. Login and OTP browser flows require one initial
safe GET before mutation. XSS remains a separate critical risk. Native clients
need a future explicit-token transport rather than a browser exception.
