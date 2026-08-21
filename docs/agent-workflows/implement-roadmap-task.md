# Workflow: implement-roadmap-task

Use when implementing a bounded EggShip roadmap task identified by ID (for example `FND-05`).

## Required reading

1. `AGENTS.md`
2. The named task in `docs/ROADMAP.md`, including dependencies, acceptance criteria, and out-of-scope lines
3. Only the instruction files and ADRs relevant to that task
4. Affected modules and the smallest useful neighboring code

For tasks that add or change list endpoints, also read `instructions/list-queries.md` (and the list summary in `instructions/api-contract.md`) and reuse `src/common/list` primitives rather than inventing per-resource pagination contracts.

Do not load unrelated domain implementations by default.

## Procedure

1. Confirm dependencies are `DONE` (or otherwise allow progress per roadmap policy). Stop if the task is `BLOCKED` or a required decision is missing.
2. Build a context packet: requirement, instructions/ADRs, domain decisions or legacy evidence, affected files/modules.
3. Implement only the task scope. Do not implement neighboring roadmap tasks.
4. Assess validation, security, authentication, authorization, ownership, transactions, concurrency, idempotency, observability, OpenAPI, and tests even when some are not applicable; record non-applicable items in the handoff.
5. Update docs and `CHANGELOG.md` when release policy requires it.
6. Update the roadmap task status only when justified by roadmap policy and the Definition of Done.
7. Run the Definition of Done verification commands applicable to the change.

## Stop conditions

Stop and report ambiguity instead of inventing business rules, architecture, destructive migration behavior, or dependency choices.

## Implementation report

Return:

- task ID and final status
- files changed
- verification commands run and results
- non-applicable Definition of Done items
- open risks or follow-ups
- next recommended roadmap task (do not start it unless asked)
