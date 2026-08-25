# ADR 0016: Commerce order-acceptance policy

## Status

Accepted

## Context

EggShip must let `SUPER_ADMIN` manage server-authoritative ordering availability and minimum cart quantity without treating Inventory as the source of closure. V1 needs a regular Tehran wall-clock schedule, one-off full-day closures and special hours, cross-midnight intervals, fail-closed missing configuration, and a coherent result when Admin settings change during Order creation.

The policy must remain PostgreSQL-authoritative and join ORD-03's existing REPEATABLE READ transaction. A generic calendar engine, JSON settings store, Redis correctness dependency, and unnecessary write-blocking are not justified.

Alternatives considered:

- Generic key/value or JSON settings (rejected: weak validation and ambiguous contracts).
- A closure-only override table (rejected: cannot represent approved special opening hours cleanly).
- Boolean plus nullable override fields (rejected: more invalid combinations than an explicit mode).
- Independent settings and override revisions (rejected: permits ambiguous mixed policy evidence).
- `FOR UPDATE` policy reads for every Order (rejected: coherent REPEATABLE READ snapshots already meet the accepted guarantee and pessimistically block Admin updates).
- Full policy snapshots on every Order (rejected for V1: revision plus evaluation instant is sufficient correlation evidence; Order money/product/customer snapshots remain separate).

## Decision

1. A small `commerce-policy` module owns typed `CommerceSettings`, `CommerceScheduleOverride`, Admin policy contracts, and Order-acceptance evaluation. Business timezone is the non-editable V1 constant `Asia/Tehran`.
2. Regular and special windows use minute-precision local wall-clock values and half-open `[opensAt, closesAt)` semantics. Cross-midnight is valid; equal times are invalid. Disabling the regular schedule means an always-open fallback, while date overrides still take precedence.
3. Each Tehran local date has at most one override with mode `CLOSED` or `SPECIAL_HOURS`. Absence means regular fallback, except for an unexpired preceding-date cross-midnight special-hours tail. A current-date override suppresses prior-date carry-in. Removing a row restores fallback behavior and increments policy revision.
4. Minimum quantity is the checked sum of normalized Order-line quantities, bounded technically to int4 `1..2147483647`; it is not SKU count, money, or Inventory availability.
5. Missing or invalid configuration fails closed. The initial migration does not invent business values: settings remain absent until a protected explicit first creation produces revision `1`.
6. One monotonic `CommerceSettings.revision` covers regular settings, minimum quantity, and every override mutation. Initial creation uses `expectedRevision = 0` and creates revision `1`; later Admin mutations atomically compare/increment it and stale writers receive `COMMERCE_POLICY_REVISION_CONFLICT`. Override rows have no separate V1 policy revision.
7. After idempotency replay/conflict detection, Order creation reads settings, relevant overrides, and one database transaction instant inside the existing outer REPEATABLE READ transaction. Snapshot consistency is sufficient; Order reads take no policy row locks. Each attempt therefore uses one committed policy state without forcing Admin updates to wait.
8. A new Order later persists `commercePolicyRevision` and the shared evaluation instant, not a full policy/override snapshot. AuditLog will later carry revision-linked mutation history.
9. COM-02 adds `COMMERCE_POLICY_MANAGE`, granted only to `SUPER_ADMIN` by the central permission policy. V1 does not add a separate Admin read permission.
10. Stable failures are `ORDERING_POLICY_UNAVAILABLE` (503), `ORDERING_CLOSED` (409), and `ORDER_MINIMUM_QUANTITY_NOT_MET` (422), with distinct displayable messages. Inventory codes remain truthful and separate.

## Consequences

- Date uniqueness, typed mode/field constraints, expected-revision Admin writes, and one RR snapshot remove half-old/half-new policy states without a generic calendar system.
- A date override can close a holiday or provide special hours without temporarily rewriting the regular schedule.
- An in-flight Order may validly complete under the committed snapshot that preceded a concurrent Admin commit; later attempts see the newer revision. This is the accepted linearization boundary.
- Redis/public policy reads may be stale for UX, but submit-time PostgreSQL evaluation remains final.
- COM-02 owns persistence/Admin API; COM-03 owns transactional enforcement. `ORD-03A` separately owns the existing User/Region transaction-context correction before customer create HTTP is exposed.
