---
name: eggship-governance
type: Always Apply
description: EggShip canonical governance - read AGENTS.md and keep changes scoped
---

# EggShip governance

Canonical policy lives in `AGENTS.md` and `instructions/*`. Do not invent competing rules.

Before editing:

1. Read `AGENTS.md` and only the instruction files relevant to the task.
2. Read the relevant roadmap task in `docs/ROADMAP.md` when implementing planned work.
3. Inspect affected modules and the smallest useful neighboring code.
4. Keep the change scoped; report unrelated issues separately.
5. Run Definition of Done verification before claiming completion.
6. Stop and report unresolved business or architecture ambiguity.

Tool directories under `.cursor/`, `.claude/`, `.codex/`, `.qoder/`, and `.trae/` are adapters only. Policy changes belong in `instructions/*`. See `instructions/agent-tooling.md`.

Do not encode a required commercial model name. Bounded implementation relies on policies, roadmap tasks, and verification—not on a particular LLM.
