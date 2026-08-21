# Database

- PostgreSQL is the source of truth. Prisma is a persistence technology, not a domain API.
- Transaction boundaries belong in the application/service layer. Never perform network calls inside a database transaction.
- Enforce important invariants with database constraints where appropriate, in addition to application checks.
- Migrations are versioned, reviewed, and deployed with `prisma migrate deploy`. Never use `prisma db push` for production deployment.
- Destructive or data-rewriting migrations require explicit review and an operational rollback or recovery plan.
- Historical business records such as orders, audit events, and inventory ledger entries must not be casually hard-deleted.
- When Redis is introduced later, it must never be authoritative for critical order or inventory state.

## Migration workflow

| Context                                | Approved command             |
| -------------------------------------- | ---------------------------- |
| Create a migration in development      | `pnpm prisma:migrate:dev`    |
| Apply migrations on staging/production | `pnpm prisma:migrate:deploy` |
| Generate Prisma Client                 | `pnpm prisma:generate`       |

Development may create migrations with the Prisma development workflow and must commit the generated SQL. Staging and production deployment must use `migrate deploy` (or the repository-approved equivalent). Never use `prisma db push` for staging or production.

Before destructive migrate, reset, or seed operations, the target environment identity must be explicit and non-production unless a separately approved production procedure exists.

Integration databases receive schema through `prisma migrate deploy` against `TEST_DATABASE_URL` (see [testing.md](testing.md)). Do not use `prisma db push` as the canonical integration path.

## Canonical identifiers

Identity columns used as login identifiers store a single canonical form, enforced in both places:

| Column        | Canonical form                                          | Database guard                               |
| ------------- | ------------------------------------------------------- | -------------------------------------------- |
| `User.phone`  | E.164 `+98` + 10 digits starting with `9`               | unique index + `CHECK`                       |
| `Admin.email` | trimmed, lowercased, conservative ASCII address pattern | unique index + `Admin_email_canonical_check` |

The unique index is the authority for identity, not a prior read: a read-then-write check cannot prevent two concurrent creations of the same identifier, so the repository translates the unique violation into a domain error instead. The `CHECK` constraint is defense in depth — it rejects a non-canonical value written by any path that bypassed the repository, which is what keeps a case-variant duplicate from slipping past a unique index that compares exact bytes.

Application lookups must normalize with the same function used on write. A lookup that skips normalization silently reports "not found" for an identifier that exists.

## Session persistence

Customer refresh sessions live on `AuthSession` (`userId` non-nullable). Admin refresh sessions live on a dedicated `AdminAuthSession` (`adminId` `ON DELETE RESTRICT`). Consumed refresh digests are likewise split (`AuthRefreshTokenConsumption` vs `AdminAuthRefreshTokenConsumption`). Do not make `AuthSession.userId` nullable and do not let a User consumption row reference an Admin session ([ADR 0008](../docs/adr/0008-admin-identity.md), [ADR 0009](../docs/adr/0009-admin-authentication.md)).

## Seed policy

This repository has no seed runner today. Future seed scripts must use synthetic development data only, must not copy production PII, should be deterministic where practical, and must not run accidentally against production. Do not add speculative domain seeders without an approved task. Seeds must never create credentials of any kind ([security.md](security.md)).
