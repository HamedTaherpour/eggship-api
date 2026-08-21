# Agent tooling

This policy governs Cursor, Claude Code, and Codex project configuration. Tool-specific directories are adapters around canonical EggShip policy; they must not become competing rule systems.

## Canonical ownership

| Source                   | Owns                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `AGENTS.md`              | Entry point and required-reading map for every coding agent |
| `instructions/*`         | Engineering policy                                          |
| `docs/adr/*`             | Accepted architecture decisions                             |
| `docs/ROADMAP.md`        | Execution plan, task status, and dependency order           |
| `docs/agent-workflows/*` | Shared skill/workflow behavior used by host adapters        |

Policy changes belong in `instructions/*` (or ADRs/roadmap when those are the correct artifact). Do not copy large policy sections into `.cursor/`, `.claude/`, or `.codex/`.

## Adapter responsibilities

Host directories may:

- point agents to `AGENTS.md` and the relevant instruction files;
- describe tool-specific invocation and review workflows;
- expose thin skill wrappers that load `docs/agent-workflows/*`;
- run deterministic guardrails where the host supports them (hooks, validation scripts);
- document host-specific limitations.

Host directories must not:

- redefine architecture, API, security, database, or testing policy;
- grant broad shell, filesystem, GitHub, database, or network permissions without need;
- store API tokens, credentials, or other secrets;
- silently install or modify MCP servers.

## Host roles

| Host            | Primary use in EggShip                                                 |
| --------------- | ---------------------------------------------------------------------- |
| Cursor          | Primary implementation environment when available, including Auto mode |
| Codex           | Bounded implementation when available                                  |
| Claude Code     | High-value adversarial review and analysis                             |
| ChatGPT + human | Architecture and unresolved business decisions                         |

Keep root `CLAUDE.md` thin: it must redirect to `AGENTS.md`. Prefer focused Cursor rules over one giant rule file. Codex project config and hooks may reinforce governance; they must not make architectural decisions.

## Skills and workflows

Shared workflow content lives in `docs/agent-workflows/`. Cursor and Claude skill files are thin adapters that instruct the agent to read the shared document. Do not maintain three divergent skill bodies.

Approved initial workflows:

- `implement-roadmap-task`
- `review-eggship-change`
- `review-prisma-migration`
- `review-concurrency-sensitive-change`

Add a new shared workflow only when the need is repeated and justified. Claude reviewer agents must review against canonical EggShip policy rather than inventing separate standards.

## Model independence

Do not encode a required commercial model name in repository rules, skills, or task specs. The repository must work with Cursor Auto mode. Bounded implementation relies on policies, roadmap tasks, and verification—not on a particular LLM. Humans may manually select a stronger reasoning model for high-risk review.

## MCP governance

MCP integration must solve a concrete project workflow. Prefer official or otherwise trusted providers, minimize permissions, and prefer read-only access when write access is unnecessary.

Rules:

- Never store MCP secrets in Git.
- Never expose production database credentials to development MCPs.
- Adding an MCP with write access requires explicit human approval.
- External MCPs must be reviewed for security and maintenance risk.
- AI agents must not install or modify MCP servers silently.

Candidate integrations (GitHub, PostgreSQL/Prisma development tooling, NestJS docs, Liara) may be evaluated later. None are enabled in this repository until a concrete workflow and human approval exist. Absence of project MCP config means no project-scoped MCP is configured.

## Permissions and secrets

Project AI config must remain least-privilege. Secrets belong in local/user configuration or deployment secrets, never under `.cursor/`, `.claude/`, or `.codex/`. Gitignore personal override files such as `.claude/settings.local.json`.

## Validation

`pnpm check:agent-tooling` verifies that required canonical files exist, host wrappers stay thin and point at `AGENTS.md`, and shared workflows remain referenced by adapters. It does not claim that Cursor, Claude, or Codex themselves validated host-native schemas unless an official validator was actually run.
