# Workflow: close-roadmap-task

Use when closing a roadmap task/slice, preparing a commit, or verifying acceptance evidence before status changes.

## Required reading

1. `AGENTS.md`
2. The named task in `docs/ROADMAP.md` (acceptance criteria and out-of-scope)
3. `instructions/definition-of-done.md` and `instructions/releases.md` as applicable
4. Any verification artifacts already produced for the slice

## Procedure

1. Verify acceptance evidence against the task contract (tests, docs, OpenAPI, changelog as required).
2. Inspect `git status` and intended diffs; identify unrelated working-tree files and artifacts to **preserve**.
3. Stage **only** intended paths. Never use `git add .`.
4. Run `git diff --cached --check` (and any DoD checks still outstanding).
5. Change roadmap status only when:
   - the user explicitly instructed closure, and
   - acceptance + Definition of Done are met.
6. If a task moves to `DONE`, recount / update roadmap summary fields per `docs/ROADMAP.md` conventions.
7. Commit only when the user explicitly asks. Do not push unless explicitly instructed.
8. Return a closure report: status, files staged/changed, verification evidence, preserved unrelated paths, follow-ups.

## Stop conditions

- Do not mark `DONE` on partial slices unless the roadmap task itself is complete.
- Do not discard or overwrite unrelated artifacts.
- Do not invent remaining acceptance evidence.
