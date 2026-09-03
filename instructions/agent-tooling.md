# Agent tooling

This policy governs Cursor, Claude Code, Codex, Qoder, TRAE, OpenCode, and future coding-agent adapters. Host-specific directories are adapters around canonical EggShip policy; they must not become competing rule systems.

## Canonical ownership

| Source                      | Owns                                                    |
| --------------------------- | ------------------------------------------------------- |
| `AGENTS.md`                 | Repository-wide agent guidance and required-reading map |
| `instructions/*`            | Engineering policy                                      |
| `docs/adr/*`                | Accepted architecture decisions                         |
| `docs/ROADMAP.md`           | Execution plan and task status                          |
| `docs/agent-workflows/*`    | Detailed shared workflow behavior                       |
| `.agents/skills/*/SKILL.md` | Reusable, host-neutral skill entrypoints                |

Policy changes belong in the canonical sources above. Do not copy policy, ADRs, or full workflow bodies into host directories.

## Verified host capability matrix

| Host        | Durable project guidance                     | Project skill discovery                                | EggShip adapter                                                                     |
| ----------- | -------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Cursor      | `AGENTS.md` and `.cursor/rules`              | `.agents/skills` (also recognizes compatibility paths) | `.cursor/rules` only for Cursor scoping/tool hints; shared skills are canonical     |
| Codex       | `AGENTS.md` and trusted `.codex/config.toml` | `.agents/skills`                                       | `.codex/config.toml` plus justified lifecycle hooks; no `.codex/skills` mirror      |
| Claude Code | root `CLAUDE.md` / project guidance          | `.claude/skills`                                       | Thin `CLAUDE.md` redirect and thin native skill adapters                            |
| Qoder       | `AGENTS.md`                                  | `.qoder/skills`                                        | Thin native skill adapters and host rules                                           |
| TRAE        | `AGENTS.md` (import toggle) + `.trae/rules`  | `.agents/skills` (enable `.agents` Skills Directory)   | Thin `.trae/rules/project_rules.md` only; do not mirror skills under `.trae/skills` |
| OpenCode    | `AGENTS.md` (native project rules)           | `.agents/skills` (native agent-compatible path)        | `opencode.json` permissions only; no `.opencode/skills` mirror                      |

This matrix was checked against current official host documentation on 2026-08-28 for Cursor/Codex/Claude/Qoder, on 2026-09-03 for TRAE ([Rules](https://docs.trae.ai/ide/rules), [Skills](https://docs.trae.ai/ide/skills), [Auto-run & security](https://docs.trae.ai/ide/auto-run-and-security)), and on 2026-09-03 for OpenCode ([Rules](https://opencode.ai/docs/rules/), [Skills](https://opencode.ai/docs/skills/), [Permissions](https://opencode.ai/docs/permissions/), [Config](https://opencode.ai/docs/config/)). Documentation describes `.agents/skills` as the shared Agent Skills location for Codex/Cursor/TRAE (TRAE requires enabling the `.agents` Skills Directory in Import Settings). Claude Code and Qoder document their own project skill roots. Do not infer support for an undocumented host path.

## Shared skills

The authoritative skills are:

| Skill                                 | Purpose                                                      |
| ------------------------------------- | ------------------------------------------------------------ |
| `implement-roadmap-task`              | Start and implement a bounded roadmap task                   |
| `verify-postgres-integration`         | Focused real-PostgreSQL integration proof with TEST DB gates |
| `review-prisma-migration`             | Prisma/migration work and review                             |
| `close-roadmap-task`                  | Slice/task closure and focused commit preparation            |
| `review-eggship-change`               | Adversarial implementation/diff review                       |
| `review-concurrency-sensitive-change` | Concurrent mutation path review                              |

Each canonical `SKILL.md` has standard YAML frontmatter and points to the relevant detailed workflow. Claude and Qoder wrappers are retained only because their documented project discovery roots differ; wrappers must point to `.agents/skills/<name>/SKILL.md` and the shared workflow. Cursor, Codex, TRAE, and OpenCode consume `.agents/skills` directly (TRAE: enable Import Settings → Enable `.agents` Skills Directory; OpenCode: project agent-compatible path, loaded on demand via the `skill` tool).

Add a shared skill only when a repeated workflow justifies it. Keep the entrypoint concise and load detailed references progressively. Skills encode **procedure**; domain knowledge stays in `instructions/*` and ADRs.

## TRAE adapter

- Project rules: `.trae/rules/project_rules.md` (`alwaysApply: true`). Concise guardrails only; `AGENTS.md` remains authoritative.
- Skills: use `.agents/skills` (do **not** duplicate under `.trae/skills`).
- Nested `AGENTS.md`: root only unless a real subdomain needs local governance.
- Custom TRAE Agent: not required while Rules + Skills cover repeated workflows.
- Short prompts should name the task and skills, for example: `Implement ORD-07 Slice 6. Use implement-roadmap-task and verify-postgres-integration. Do not commit.`

### Recommended TRAE command safety

Prefer **Sandbox with Allowlist** (or Manual Run). Do **not** enable unrestricted Auto Run for EggShip backend work initially.

Reasonable allowlist candidates (after human review): `pnpm`, `node`, `npx`, `jest` test runners used by this repo.

Never auto-approve:

- destructive git (`reset --hard`, `clean -fd`, force push, rewrite history)
- `git push` / tagging / release / deploy
- production or shared-infrastructure database/Redis commands
- destructive Prisma migrate/reset/seed outside the dedicated TEST DB flow
- secret file edits (`.env`, credentials)

Keep MCP Auto-Run off unless a reviewed MCP is explicitly approved (none are project-configured today).

## OpenCode adapter

- Project rules: root `AGENTS.md` is consumed natively. Do **not** run `/init` to regenerate or replace it; EggShip's existing `AGENTS.md` is canonical.
- Skills: use `.agents/skills` (do **not** duplicate under `.opencode/skills`).
- Config: `opencode.json` holds OpenCode-specific project configuration only (safe `permission` guardrails). It must not copy canonical policy or list `instructions`; `AGENTS.md` already routes lazy loading of `instructions/*`, ADRs, and workflows, which keeps initial context small.
- Skills load on demand via the `skill` tool, so short prompts name the task and skills, for example: `Implement ORD-07 Slice 6. Use implement-roadmap-task and verify-postgres-integration. Do not commit.`
- Nested `AGENTS.md`: root only unless a real subdomain needs local governance.

### Recommended OpenCode execution safety

Default to review mode (no `--auto`). `opencode.json` allows normal read/write within the repo, allows safe runners (`pnpm`, `npx`, `node`) and read-only git (`status`, `diff`, `log`), asks for everything else, and denies:

- `git push` and destructive git (`reset --hard`, `clean`, force checkout)
- destructive Prisma migrate/reset/`db push` outside the dedicated TEST DB flow
- production or shared-infrastructure database/Redis commands
- secret file edits (`.env`)
- `rm -rf`

No project MCP is configured. Run OpenCode from the repository root so `.agents/skills` discovery walks up to the git worktree.

## Adapter responsibilities

Host directories may point agents to canonical sources, describe host-specific invocation/scoping, and run deterministic mechanical guardrails where supported. They must not redefine architecture, API, security, database, testing, release, or business policy; store secrets; silently install MCP servers; or make autonomous release/deploy decisions.

`.cursor/rules`, `.qoder/rules`, and `.trae/rules` are host activation/scoping adapters only. `CLAUDE.md` redirects to `AGENTS.md`; `AGENTS.md` remains authoritative. `.codex/config.toml` contains only trusted-repository settings supported by the installed Codex release. `opencode.json` contains only OpenCode-supported project permissions. No project-scoped MCP is enabled.

## Hooks and safety

Git enforcement belongs under `.husky` and is distinct from AI lifecycle hooks. `.codex/hooks` currently provides context pointers and a completion-evidence check; it does not own policy or make architecture decisions. Host hooks must remain mechanical and preserve canonical safety: no automatic push/tag/release/deploy, no production/shared-infrastructure mutation without approval, no secret commits, no unsafe test-database destruction, no legacy-backup access, and no discarding unrelated changes.

## Future host onboarding

1. Keep EggShip policy in `AGENTS.md`, `instructions/*`, ADRs, and shared workflows.
2. Verify what the new host natively discovers using current official documentation.
3. Reuse `AGENTS.md` and `.agents/skills` when supported.
4. Add only a thin native adapter for unsupported discovery or activation surfaces.
5. Extend `scripts/check-agent-tooling.mjs` with stable path/frontmatter/source checks.
6. Never copy policy or full shared skills into a new host directory.

## Model and MCP independence

Do not encode a required commercial model name. The repository must work with Cursor Auto mode and host-default models. MCP integration requires a concrete workflow, trusted provider review, least privilege, and explicit human approval for write access; no project MCP is currently configured.

## Validation

`pnpm check:agent-tooling` verifies canonical files, skill frontmatter and uniqueness, workflow references, thin Claude/Qoder adapters, host-rule pointers (including `.trae/rules`), Codex/TRAE/OpenCode absence of a duplicate shared skill tree, `opencode.json` permission guardrails, required host files, and secret-pattern absence. It does not claim that host binaries or undocumented schemas were run.
