# Auth module

Owns authentication session persistence, token/password infrastructure, customer OTP/completion, User refresh/logout, and Admin login/session HTTP (ADM-AUTH-01).

| Path              | Role                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `domain/`         | Session records, cookie policy (customer + Admin namespaces), principals, refresh digests, OTP, Auth errors       |
| `application/`    | `SessionLifecycleService`, `AdminSessionLifecycleService`, `AdminLoginService`, `OtpService`, customer completion |
| `infrastructure/` | User/Admin session repositories, Argon2 hasher, token services, Redis OTP/grant stores, Admin login abuse limiter |
| `api/`            | `AuthController`, `AdminAuthController`, cookie writer, request-source IP resolver, `AccessTokenGuard`            |
| `auth.module.ts`  | Nest registration                                                                                                 |

Browser product transport:

- Customer: HttpOnly `eggship_at` / `eggship_rt` (`Path=/`)
- Admin: HttpOnly `eggship_admin_at` / `eggship_admin_rt` (`Path=/api/v1/admin`)

CSRF is still required before production browser exposure. Policy: [instructions/authentication.md](../../../instructions/authentication.md), [ADR 0009](../../../docs/adr/0009-admin-authentication.md).

Customer routes remain customer-scoped. Admin auth routes are Admin-scoped. An authenticated principal of the wrong subject type receives 403, not 401.
