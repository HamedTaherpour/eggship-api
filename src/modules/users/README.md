# Users module

Owns customer/store identity persistence and authenticated profile reads/updates.

| Path              | Role                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `domain/`         | User record types, Iranian phone normalization                    |
| `application/`    | `CustomerProfileService` (current-user load / allowlisted update) |
| `infrastructure/` | `UserRepository` (`create`, `findById`, `findByPhone`)            |
| `api/`            | `UsersController` (`PATCH /users/me`)                             |
| `users.module.ts` | Nest registration                                                 |

The authenticated storefront subject is the `User` row itself. AUTH-07 identity is phone-only; mutable business profile fields await evidenced legacy inventory (`MIG-01`). Policy: [instructions/authentication.md](../../../instructions/authentication.md).
