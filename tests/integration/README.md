# Infrastructure integration tests

Real PostgreSQL and Redis integration suites live here. They are separate from ordinary unit and lightweight e2e tests.

```bash
pnpm test                 # no Docker / no live infra
pnpm test:e2e             # no Docker / no live infra
pnpm test:integration     # requires INTEGRATION_TESTS_ENABLED + TEST_* URLs
pnpm test:integration:postgres
pnpm test:integration:redis
pnpm test:integration:storage   # optional dedicated TEST object storage; never production
```

See [instructions/testing.md](../../instructions/testing.md) for taxonomy, safety, isolation, CI, and remote TEST resource rules.

Auth persistence suites under `postgres/` may truncate `User` / `AuthSession` between cases. That requires `INTEGRATION_ALLOW_DESTRUCTIVE=true` in addition to `INTEGRATION_TESTS_ENABLED=true` (set in CI for the ephemeral integration database).

Combined PostgreSQL + Redis domain suites live under `domain/` and run only with `pnpm test:integration` (`--suite=all`).
