# Agent tooling

This policy governs Cursor, Claude Code, Codex, Qoder, and future coding-agent adapters. Host-specific directories are adapters around canonical EggShip policy; they must not become competing rule systems.

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

| Host        | Durable project guidance                     | Project skill discovery                                | EggShip adapter                                                                 |
| ----------- | -------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Cursor      | `AGENTS.md` and `.cursor/rules`              | `.agents/skills` (also recognizes compatibility paths) | `.cursor/rules` only for Cursor scoping/tool hints; shared skills are canonical |
| Codex       | `AGENTS.md` and trusted `.codex/config.toml` | `.agents/skills`                                       | `.codex/config.toml` plus justified lifecycle hooks; no `.codex/skills` mirror  |
| Claude Code | root `CLAUDE.md` / project guidance          | `.claude/skills`                                       | Thin `CLAUDE.md` redirect and thin native skill adapters                        |
| Qoder       | `AGENTS.md`                                  | `.qoder/skills`                                        | Thin native skill adapters and host rules                                       |

This matrix was checked against current official host documentation on 2026-08-28: [Codex skills](https://developers.openai.com/codex/skills), [Cursor Agent Skills](https://cursor.com/docs/skills), [Claude Code skills](https://code.claude.com/docs/en/slash-commands), [Claude Code memory](https://code.claude.com/docs/en/memory), and [Qoder CLI skills](https://docs.qoder.com/cli/Skills). Documentation describes `.agents/skills` as the shared Agent Skills location for Codex/Cursor, while Claude Code and Qoder document their own project skill roots. Do not infer support for an undocumented host path.

## Shared skills

The authoritative skills are `implement-roadmap-task`, `review-eggship-change`, `review-prisma-migration`, and `review-concurrency-sensitive-change`. Each canonical `SKILL.md` has standard YAML frontmatter and points to the relevant detailed workflow. Claude and Qoder wrappers are retained only because their documented project discovery roots differ; wrappers must point to `.agents/skills/<name>/SKILL.md` and the shared workflow. Cursor and Codex consume `.agents/skills` directly.

Add a shared skill only when a repeated workflow justifies it. Keep the entrypoint concise and load detailed references progressively.

## Adapter responsibilities

Host directories may point agents to canonical sources, describe host-specific invocation/scoping, and run deterministic mechanical guardrails where supported. They must not redefine architecture, API, security, database, testing, release, or business policy; store secrets; silently install MCP servers; or make autonomous release/deploy decisions.

`.cursor/rules` and `.qoder/rules` are host activation/scoping adapters only. `CLAUDE.md` redirects to `AGENTS.md`; `AGENTS.md` remains authoritative. `.codex/config.toml` contains only trusted-repository settings supported by the installed Codex release. No project-scoped MCP is enabled.

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

`pnpm check:agent-tooling` verifies canonical files, skill frontmatter and uniqueness, workflow references, thin Claude/Qoder adapters, host-rule pointers, Codex absence of a duplicate shared skill tree, required host files, and secret-pattern absence. It does not claim that host binaries or undocumented schemas were run.
