# Workflow: review-prisma-migration

Use when reviewing Prisma schema or migration changes. Do not invent or apply business migrations during unrelated tasks.

## Required reading

1. `AGENTS.md`
2. `instructions/database.md`
3. The migration files and related Prisma schema diff
4. Any roadmap task or ADR that justifies the schema change

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
