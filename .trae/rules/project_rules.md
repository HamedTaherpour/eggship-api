---
alwaysApply: true
---

# EggShip TRAE project rules

Canonical policy is `AGENTS.md` plus `instructions/*`, `docs/adr/*`, and `docs/ROADMAP.md`.
Do not invent competing rules. Do not copy domain policy into chat or skills.

## Before any implementation

1. Read `AGENTS.md`.
2. For roadmap work, read the named task in `docs/ROADMAP.md` (status, deps, acceptance, out-of-scope).
3. Read only the instruction files and ADRs that task/domain references.
4. Inspect the smallest useful neighboring code; do not broaden scope.

## Hard stop conditions

- Never invent Human business or architecture decisions; stop and report ambiguity.
- Do not change production behavior, public contracts, or schema outside the stated task.
- Do not start neighboring roadmap tasks.
- Roadmap status changes only during explicit closure / when Definition of Done is met.

## Package manager and API hygiene

- Use `pnpm` only.
- Keep stable error codes; no raw Prisma errors at the API boundary.
- Respect AuditLog contracts when touchpoints exist.
- Do not add Redis, BullMQ, or network I/O inside DB transactions without approved architecture.

## Database and verification

- Migrations require human review and focused real-PostgreSQL proof.
- Transaction/concurrency changes require real PostgreSQL evidence and final DB-state assertions.
- Destructive integration work uses only the dedicated TEST DB via `TEST_DATABASE_URL`.
- Never use production/runtime `DATABASE_URL` as a test cleanup target.
- Prefer `pnpm test:integration:postgres` / documented Jest patterns; classify harness/env failures separately from production defects.

## Git and working tree

- Preserve unrelated working-tree changes and known artifact files.
- Never use `git add .`.
- Do not commit or push unless explicitly instructed.
- Stage only intended paths; run `git diff --cached --check` before any requested commit.

## Skills (load procedure, not domain dumps)

Prefer shared skills under `.agents/skills` (enable TRAE ".agents Skills Directory"):

| Need                             | Skill                                 |
| -------------------------------- | ------------------------------------- |
| Roadmap implementation           | `implement-roadmap-task`              |
| PostgreSQL integration proof     | `verify-postgres-integration`         |
| Prisma/migration work or review  | `review-prisma-migration`             |
| Slice/task closure / commit prep | `close-roadmap-task`                  |
| Adversarial change review        | `review-eggship-change`               |
| Concurrency-sensitive review     | `review-concurrency-sensitive-change` |

Skills encode workflow. Domain knowledge stays in `instructions/*` and ADRs.

## Host adapters

`.trae/`, `.cursor/`, `.claude/`, `.codex/`, and `.qoder/` are adapters only.
Policy changes belong in `AGENTS.md` / `instructions/*`. See `instructions/agent-tooling.md`.
