# Admins module

Owns back-office operator identity: the canonical email, the password credential storage boundary, the persisted role, and the `AdminRoleResolver` implementation that makes ADR 0007 authorization live.

| Path                                           | Role                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `domain/admin.ts`                              | `AdminRecord` (no `passwordHash`), authorization state, login credential type |
| `domain/admin-email.ts`                        | Canonical email policy (`normalizeAdminEmail`)                                |
| `domain/admin-password-policy.ts`              | Length-oriented password policy (min 12 / max 128)                            |
| `domain/admin-errors.ts`                       | `AdminEmailAlreadyExistsError`, `UnknownAdminRoleError`                       |
| `application/admin-identity.service.ts`        | `createAdmin`, `findById`, `findLoginCredential`                              |
| `infrastructure/admin.repository.ts`           | Persistence boundary                                                          |
| `infrastructure/prisma-admin-role.resolver.ts` | `ADMIN_ROLE_RESOLVER` implementation                                          |
| `admins.module.ts`                             | Nest registration                                                             |

Admin **login HTTP and sessions** live in Auth (`AdminLoginService`, `AdminAuthSession`). This module does not own cookies or tokens.

Operator bootstrap is `pnpm admin:create` (never automatic, never a default credential). General Admin CRUD HTTP remains `ADM-01`.

## Boundaries worth preserving

- `AuthorizationModule` does not statically import this module from source. The composition root passes `AdminsModule` into `AuthorizationModule.forRoot()`.
- `AuthModule` is imported for the `PASSWORD_HASHER` port only (circular import is `forwardRef`).
- `AdminRecord` carries no `passwordHash`. Login uses the explicit `AdminLoginCredential` type.
- `role`, `isActive`, and `passwordHash` are security-sensitive. There is no generic HTTP update path.

Policy: [instructions/authentication.md](../../../instructions/authentication.md), [ADR 0008](../../../docs/adr/0008-admin-identity.md), [ADR 0009](../../../docs/adr/0009-admin-authentication.md).
