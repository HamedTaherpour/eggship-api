# Workflow: review-prisma-migration

Use when reviewing Prisma schema or migration changes. Do not invent or apply business migrations during unrelated tasks.

## Required reading

1. `AGENTS.md`
2. `instructions/database.md`
3. The migration files and related Prisma schema diff
4. Any roadmap task or ADR that justifies the schema change

## When performing migration work (not only review)

Follow `instructions/database.md`. Prefer additive-first schema changes. After generating a migration:

1. Inspect the generated SQL (FK/delete semantics, constraints, indexes).
2. Avoid speculative indexes; justify each new index from a real access path.
3. Run `prisma validate` / `prisma generate` as applicable.
4. Apply to the dedicated TEST DB via migrate deploy against `TEST_DATABASE_URL`.
5. Prove with focused real PostgreSQL integration (`docs/agent-workflows/verify-postgres-integration.md`).
6. Record rollback/failure considerations; stop for destructive or data-rewriting steps until a human reviews.

## Review focus

Issue-first. Order findings by severity. Cover at least:

- data loss and irreversible transforms
- destructive operations without explicit human review
- locking and runtime risk on populated tables
- required backfill ordering and verification
- constraint safety and existing-data compatibility
- index implications for write and read paths
- compatibility with currently running application versions
- rollback and recovery considerations (forward-fix when reverse is unsafe)

## Output format

1. Summary verdict
2. Severity-ordered findings with evidence
3. Required human approvals before apply/deploy
4. Suggested verification steps (migrate deploy dry-run thinking, data checks)—without applying destructive operations

Never recommend `prisma db push` for production. Never approve a destructive migration casually.
