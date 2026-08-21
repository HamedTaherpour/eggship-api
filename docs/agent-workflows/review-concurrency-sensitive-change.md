# Workflow: review-concurrency-sensitive-change

Use for Orders, Inventory, Discounts, sessions, idempotency keys, queue processing, outbox dispatch, or any concurrent mutation path.

## Required reading

1. `AGENTS.md`
2. `instructions/architecture.md`, `instructions/database.md`, `instructions/queues.md`, and `instructions/testing.md` as applicable
3. The change under review and the owning module contracts

## Review focus

Issue-first. Order findings by severity. Cover at least:

- race conditions and lost updates
- atomicity of multi-step state changes
- lock ordering for multi-resource operations
- retry semantics and duplicate request handling
- unique constraints that enforce business identity
- transaction scope that is too wide, too narrow, or includes network I/O
- idempotency keys and successor/token-family advancement
- failure-after-commit and crash recovery behavior
- queue at-least-once delivery interacting with durable state

Prefer evidence from code paths and tests over speculative claims. Call out missing concurrency tests when the risk is material.

## Output format

1. Summary verdict
2. Severity-ordered findings with concrete race scenarios
3. Required tests or invariants still missing
4. Human decisions needed before claiming safety
