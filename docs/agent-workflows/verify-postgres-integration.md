# Workflow: verify-postgres-integration

Use when running or reviewing focused real-PostgreSQL integration proof for EggShip.

## Required reading

1. `AGENTS.md`
2. `instructions/testing.md` and `instructions/environment.md`
3. The roadmap task or change under test (acceptance criteria)
4. Relevant domain instructions/ADRs only as needed to interpret expected DB state

Do not paste credentials into chat, logs, or artifacts.

## Safety gates

- Use a dedicated disposable TEST database only.
- Require `TEST_DATABASE_URL` (never production/runtime `DATABASE_URL` for cleanup or truncate).
- Prefer the repository wrapper when it forwards flags correctly:

```bash
NODE_ENV=test INTEGRATION_SUITE=postgres INTEGRATION_TESTS_ENABLED=true INTEGRATION_ALLOW_DESTRUCTIVE=true pnpm test:integration:postgres -- --runInBand <pattern>
```

- When the pnpm/Jest wrapper does not forward the pattern, run Jest directly with the same env and `--runInBand`.
- Do not start Redis unless the scenario logically requires it.
- Schema for TEST DB comes through migrate deploy against `TEST_DATABASE_URL` per `instructions/database.md` / `instructions/testing.md`.

## Procedure

1. Confirm env gates and that the target is the dedicated TEST DB.
2. Choose the narrowest Jest file/name pattern that proves the acceptance claim.
3. Run focused PostgreSQL integration first; broaden only if needed for regression.
4. For concurrency/stampede claims, assert **final durable DB state**, not only HTTP responses.
5. Classify failures before changing production code:
   - harness / env / migrate / credential / wrong DB → fix environment, do not weaken product code
   - genuine product defect → fix with scoped change and re-prove
6. Record commands, patterns, and pass/fail evidence in the handoff.

## Stop conditions

Stop if `TEST_DATABASE_URL` is missing, points at runtime/production, or safety guards refuse the run. Never bypass those guards.
