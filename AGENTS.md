# AI agent policy

This file is the primary instruction entry point for every AI coding agent working in EggShip API. Read this file and the policies relevant to the proposed change before editing code.

## Required reading

- [Architecture](instructions/architecture.md) for module boundaries and dependency direction.
- [API contract](instructions/api-contract.md) for HTTP behavior and response shapes.
- [List queries](instructions/list-queries.md) for pagination, search, sort allowlists, and list filter semantics.
- [Catalog](instructions/catalog.md) for Category/Region reference ownership and lifecycle boundaries.
- [Content](instructions/content.md) for Blog publication, Markdown, taxonomy, Author, SEO, and public content boundaries ([ADR 0021](docs/adr/0021-blog-content-architecture.md)).
- [Pricing](instructions/pricing.md) for current price vs PriceHistory ownership and change semantics.
- [Media](instructions/media.md) for Media library storage, upload bounds, attachment/reference lifecycle, and deletion/orphan policy ([ADR 0011](docs/adr/0011-media-object-storage-and-multi-upload.md), [ADR 0022](docs/adr/0022-media-attachment-and-reference-lifecycle.md)).
- [Inventory](instructions/inventory.md) for stock quantities, ledger, reservation lifecycle, and Orders↔Inventory boundaries.
- [Orders](instructions/orders.md) for order snapshots, ownership, money, and Inventory orchestration boundaries.
- [Commerce policy](instructions/commerce-policy.md) for ordering hours, minimum cart quantity, and Order-acceptance settings.
- [Settlement](instructions/settlement.md) for post-delivery deferred-settlement tracking and Media references.
- [Analytics](instructions/analytics.md) for business-day semantics, lifecycle metrics, sales, returns, product rankings, inventory reconstruction, and historical limitations.
- [Referrals](instructions/referrals.md) for V1 Visitor attribution, registration boundaries, immutability, and abuse policy.
- [Code quality](instructions/code-quality.md) for TypeScript and review expectations.
- [Testing](instructions/testing.md) for required test layers and practices.
- [Security](instructions/security.md) for validation, secrets, logging, and authorization.
- [Authentication](instructions/authentication.md) for identity boundaries, sessions, cookies/CSRF, and token policy.
- [Authorization](instructions/authorization.md) for permissions, RBAC, and ownership checks.
- [Environment](instructions/environment.md) for local/remote environment workflow, `.env` policy, and infrastructure safety.
- [Observability](instructions/observability.md) for structured logs, context propagation, redaction, and error severity.
- [Redis](instructions/redis.md) for ephemeral infrastructure, configuration, readiness, and cache rules.
- [Queues](instructions/queues.md) for asynchronous job delivery, payloads, retries, idempotency, and worker boundaries.
- [Database](instructions/database.md) for Prisma, transactions, and migration safety.
- [Releases](instructions/releases.md) for versions, commits, and changelog rules.
- [AI governance](instructions/ai-governance.md) for agent-specific constraints.
- [Agent tooling](instructions/agent-tooling.md) for Cursor/Claude/Codex adapters, skills, MCP, and model-independence rules.
- [Definition of done](instructions/definition-of-done.md) before claiming completion.

## Non-negotiable rules

- Do not change the approved architecture without explicit approval.
- Do not add a dependency without explaining why it is necessary and checking whether the platform already provides the capability.
- Never suppress TypeScript, lint, or test failures as a shortcut. Do not use `any`, `@ts-ignore`, blanket lint disables, or equivalent escape hatches.
- Never remove or weaken tests merely to make CI pass.
- Never create or apply a destructive migration without explicit human review.
- For every change, assess validation, security, authentication, authorization, ownership, and test implications—even when some are not applicable.
- Update documentation when behavior, contracts, operations, or architecture change.
- Update `CHANGELOG.md` for meaningful user-facing, API, security, database, or architecture changes.
- Stop and report unresolved business or architecture ambiguity instead of inventing a rule.

Follow the narrowest architecture that satisfies the approved requirement. Business features require their own scoped task.
