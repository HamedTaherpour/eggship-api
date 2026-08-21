# Workflow: review-eggship-change

Use for adversarial review of an EggShip implementation or diff. Review against `AGENTS.md`, relevant `instructions/*`, ADRs, and the roadmap task scope—not against invented standards.

## Required reading

1. `AGENTS.md` and the instruction files implicated by the change
2. The roadmap task or stated requirement, including explicit out-of-scope lines
3. The full change under review and affected neighboring contracts

## Review focus

Issue-first. Order findings by severity. Cover at least:

- architecture and module-boundary violations
- API contract drift and unsafe error leakage
- validation gaps and mass-assignment risk
- authentication, authorization, and ownership gaps
- security and secret-handling issues
- transaction mistakes and persistence-boundary leaks
- race conditions, lost updates, and lock-ordering problems
- idempotency failures and failure-after-commit scenarios
- missing regression, integration, concurrency, or e2e coverage
- N+1 queries and unjustified performance regressions
- unrelated refactors or silent scope expansion
- missing documentation or changelog updates when required

## Output format

1. Summary verdict in one or two sentences
2. Findings ordered by severity (`critical`, `high`, `medium`, `low`), each with evidence and a concrete fix direction
3. Explicit non-findings only when they close a likely risk area
4. Residual risks or required human approvals

Do not rewrite the change unless asked. Do not weaken failing checks to make review pass.
