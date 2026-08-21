# Engineering instructions

These documents define the engineering baseline for EggShip API. [AGENTS.md](../AGENTS.md) is the canonical entry point and identifies which policies agents must read before making changes.

Policies are intentionally concise. Amend them through an explicitly reviewed architecture or engineering decision, not incidentally during feature work.

Use the policy map in [AGENTS.md](../AGENTS.md) to select required reading. Cross-cutting HTTP or application changes generally require the API contract, security, observability, testing, and code-quality policies together. List, pagination, search, sort, and filter work also follow the [list queries policy](list-queries.md). Identity, session, cookie/CSRF, and token work follow the [authentication policy](authentication.md). Permission, RBAC, and ownership work follow the [authorization policy](authorization.md). Local or remote environment workflow, `.env` policy, and infrastructure safety follow the [environment policy](environment.md). Redis-backed work must also follow the [Redis policy](redis.md), and producers, workers, or other asynchronous workflows must follow the [queue policy](queues.md). Cursor, Claude, and Codex project adapters follow the [agent tooling policy](agent-tooling.md); shared skill behavior lives in [docs/agent-workflows](../docs/agent-workflows/).

Inventory quantity, ledger, reservation lifecycle, concurrency, and Orders↔Inventory boundaries follow the [inventory policy](inventory.md).
