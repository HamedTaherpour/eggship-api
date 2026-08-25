# Commerce and order-acceptance policy

This policy records the accepted V1 architecture for mutable, server-authoritative Order acceptance. The durable decision is [ADR 0016](../docs/adr/0016-commerce-order-acceptance-policy.md). `COM-01` is governance only; `COM-02` owns typed persistence and Admin API; `COM-03` owns transactional Order-create enforcement.

## Boundary and authority

- `src/modules/commerce-policy` owns typed settings, date overrides, Admin mutation/query contracts, and a persistence-neutral Order-acceptance evaluation contract.
- Orders calls that contract after idempotency replay/conflict detection and before User/Region resolution, pricing, Order persistence, or Inventory reservation.
- The policy affects only creation of a new logical Order. An idempotent replay returns its existing Order without re-evaluating current policy. Existing Orders and Admin fulfillment, Inventory receiving/adjustment/reconciliation, and other operations are unaffected.
- PostgreSQL is authoritative. Frontend/mobile clocks and validation are UX aids only. Redis may later cache public display data, but no Redis value, lock, or cache participates in acceptance correctness.

## Business time

- V1 business timezone is the immutable domain constant `Asia/Tehran`; it is not an Admin-editable setting. Generic timestamp and list utilities remain timezone-neutral.
- Order/audit timestamps remain UTC instants. Schedule values are local wall-clock times without a date, at minute precision. Persistence must reject non-zero seconds/fractions.
- One PostgreSQL transaction instant is resolved for the attempt and converted to `Asia/Tehran`. The same instant should be passed to pricing and persisted as the Order's evaluation-time evidence; controllers and clients do not supply it.
- All time windows are half-open: `[opensAt, closesAt)`. Opening minute is accepted; closing minute is rejected.
- Cross-midnight windows are supported. `opensAt > closesAt` means the interval continues into the next local date. `opensAt == closesAt` is invalid and never means closed or 24 hours.

For `07:00 -> 16:00`, `06:59` and `16:00` are closed while `07:00` through `15:59` are open. `18:00 -> 02:00` is valid.

## Typed conceptual persistence (COM-02)

Do not use generic key/value or JSON settings persistence.

```text
CommerceSettings
  singleton id
  orderingScheduleEnabled
  orderingOpensAtLocal
  orderingClosesAtLocal
  minimumOrderQuantity
  revision
  createdByAdminId
  updatedByAdminId
  createdAt / updatedAt

CommerceScheduleOverride
  id
  localDate                 # Asia/Tehran calendar date; unique
  mode                      # CLOSED | SPECIAL_HOURS
  opensAtLocal              # SPECIAL_HOURS only
  closesAtLocal             # SPECIAL_HOURS only
  createdByAdminId
  updatedByAdminId
  createdAt / updatedAt
```

`orderingOpensAtLocal` and `orderingClosesAtLocal` remain required and unequal even while the regular schedule is disabled. This avoids nullable-state ambiguity and leaves a validated schedule ready for re-enablement. `orderingScheduleEnabled = false` means the regular fallback is always open; a date override still takes precedence.

`CommerceScheduleOverride.mode` is an enum rather than a closure boolean plus ambiguous nullable fields:

- `CLOSED`: both time fields must be absent and the entire `localDate` is closed.
- `SPECIAL_HOURS`: both minute-precision time fields are required and unequal. Cross-midnight is allowed.
- Any other combination is invalid at both application and database boundaries.

There is exactly one override per local date. Absence of an override means use the regular fallback, except that the unexpired tail of a preceding date's cross-midnight `SPECIAL_HOURS` override still applies as described below. There is no `USE_REGULAR` mode. Removing an override is a deliberate hard delete that increments the policy revision; the future AuditLog records the removal. Soft deletion and a generic calendar engine are not justified.

The migration does not invent business opening hours or a minimum. Initial state is an absent singleton, which fails closed. A `SUPER_ADMIN` explicitly creates the first valid settings revision through the protected COM-02 bootstrap/create contract before customer ordering can open. Overrides cannot be created until the singleton exists.

## Date-override resolution

At the transaction instant, let `D` be the current Tehran local date and `T` the local wall-clock minute. Read the singleton plus overrides for `D` and the preceding local date in the same transaction snapshot.

1. If an override exists for `D`, it governs the whole calendar date and suppresses any carry-in from the preceding date:
   - `CLOSED` rejects every instant on `D`.
   - `SPECIAL_HOURS` accepts only its interval anchored on `D`. For a cross-midnight interval, the portion on `D` starts at `opensAt`; its after-midnight tail may continue into `D + 1`.
2. If no override exists for `D`, an unexpired cross-midnight `SPECIAL_HOURS` interval anchored on `D - 1` takes precedence during its after-midnight tail.
3. Otherwise evaluate the regular fallback: always open when `orderingScheduleEnabled = false`, or the configured daily regular window when enabled.

This makes a full-day closure truly closed despite a prior day's spill, allows an explicit next-date override to truncate that spill, and still gives cross-midnight overrides meaningful behavior. Local dates are PostgreSQL `date` semantics interpreted only in `Asia/Tehran`; no UTC-date comparison is permitted.

## Minimum order quantity

- `minimumOrderQuantity` is configurable by `SUPER_ADMIN` and uses the existing `OrderLine.quantity` whole-unit semantics.
- Normalize/collapse duplicate Product lines first, then sum all normalized quantities. The minimum is not SKU count, monetary amount, pre-normalized line count, or Inventory availability.
- V1 technical bounds are `1..2147483647` (PostgreSQL int4). Summation must use checked wider arithmetic and reject overflow/invalid input rather than wrapping. A narrower commercial maximum requires a later product decision.
- Evaluate after time availability and before User/Region reads, pricing, persistence, or reservation. A failure writes nothing and is not mapped to Inventory.

For minimum `5`, Product A x 2 plus Product B x 3 is valid.

## Evaluation precedence

Line normalization and the idempotency payload hash are prepared before the transactional decision. Inside the existing ORD-03 REPEATABLE READ transaction:

1. Acquire the create-idempotency advisory lock and return replay/conflict if an Order already owns the key.
2. Load one coherent Commerce policy revision and the relevant override rows.
3. Resolve the one database transaction instant into Tehran local date/time.
4. Apply the current-date override and any permitted preceding-date cross-midnight tail.
5. If no override interval controls the instant, apply the regular schedule.
6. Compare the checked sum of normalized line quantities with the configured minimum.
7. Continue the authoritative User/Region, pricing, Order persistence, and Inventory reservation flow.

The idempotency check remains first so a committed replay does not become invalid when policy changes. Schedule checks precede the minimum so one request receives one truthful primary acceptance reason and no downstream reads or writes occur while ordering is closed.

## One revision and transaction semantics

- `CommerceSettings.revision` is a positive, monotonically increasing policy-wide revision. The first explicit settings creation is revision `1`.
- Every effective settings change and every override create, update, or removal increments that same revision in the same PostgreSQL transaction as the mutation. No-op updates do not increment it.
- Override rows do not have an independent policy revision in V1. One global revision is the smallest model that prevents settings/override version ambiguity and supports optimistic Admin writes.
- Admin mutation commands require an expected revision. Initial singleton creation uses the explicit sentinel `expectedRevision = 0` and creates revision `1`; the singleton uniqueness constraint elects one winner. Later revision compare-and-increment serializes concurrent Admin mutations; a stale expected revision returns `COMMERCE_POLICY_REVISION_CONFLICT` rather than silently overwriting another change.
- Order creation reads settings, relevant overrides, and the transaction instant through the same outer REPEATABLE READ transaction. The snapshot alone is sufficient for a coherent committed policy state; Order reads do not take `FOR UPDATE` locks on policy rows.
- Admin updates therefore need not wait for in-flight Order creation. An Order is accepted or rejected under the committed policy snapshot visible to its transaction; a later-committing Admin change may govern subsequent attempts. This is the accepted linearization model.
- Policy must be evaluated before pricing. All policy reads must receive the opaque outer transaction context; reading settings or overrides through a default client is forbidden.

The Admin repository must not expose mutation paths that can change an override without the singleton revision increment. PostgreSQL constraints cover row shape and date uniqueness; the application transaction covers cross-row revision consistency. Invalid or conflicting persisted policy fails closed.

## Historical evidence

COM-03 should persist the accepted `commercePolicyRevision` on a newly created Order and reuse/persist the shared evaluation instant (prefer the existing pricing evaluation instant when one instant serves both operations). It does not snapshot regular hours, minimum quantity, override fields, or Admin metadata onto Order.

The global revision plus evaluation instant is the minimal debugging/audit correlation evidence. Future AuditLog mutation events provide revision-linked change history. Existing Orders never re-evaluate mutable policy.

## Authorization and public reads

- Add the dedicated `COMMERCE_POLICY_MANAGE` permission in COM-02 and grant it only to `SUPER_ADMIN` through the central role policy enumeration. There is no role branch or superuser bypass.
- V1 Admin read and mutation operations both require `COMMERCE_POLICY_MANAGE`; a separate Admin read permission is not justified yet. Both standard Admin guards and strict DTO allowlists apply, and actor ids come from the authenticated principal.
- A later customer/public read contract may expose only derived UX-safe fields such as `acceptingOrders`, `minimumOrderQuantity`, `evaluatedAt`, and an optional `nextTransitionAt` when it can be derived reliably. Do not expose `revision`, Admin ids, audit metadata, or raw persistence shape. Submit-time evaluation remains final even when a displayed read becomes stale.

## Implemented Order-acceptance enforcement (COM-03)

`CommercePolicyService.evaluateOrderAcceptance(normalizedLines, tx)` is the Orders-facing contract. `OrderCreationService.createOrder` calls it after create-idempotency replay/conflict detection and before User/Region reads, pricing, persistence, or reservation, inside the existing REPEATABLE READ transaction:

1. Resolve one PostgreSQL `CURRENT_TIMESTAMP` (transaction instant) through the opaque outer `tx`.
2. Convert that instant to `Asia/Tehran` local date/minute.
3. Lock-free read of `CommerceSettings` plus overrides for `D` and `D - 1` on the same snapshot.
4. Apply current-date override / prior-date SPECIAL_HOURS tail / regular fallback per ADR 0016.
5. Compare the checked sum of already-normalized line quantities with `minimumOrderQuantity`.
6. On accept, return `{ revision, evaluatedAt, ... }`. Orders passes `evaluatedAt` into PRC-05 and persists `Order.commercePolicyRevision` with the shared `pricingEvaluatedAt`.

Replays of an existing idempotent Order skip policy re-evaluation. Policy rejection rolls back with no Order, lines, reservation, ledger, or idempotency row, so the same client key may succeed later when policy/input permits. Missing/invalid policy fails closed as `ORDERING_POLICY_UNAVAILABLE`. Controllers and clients never supply evaluation time, revision, or policy fields.

COM-03 does not expose a public policy/availability endpoint and does not absorb the ORD-03A User/Region transaction-context correction.

## Implemented Admin contract (COM-02)

All routes are under `/api/v1/admin/commerce-policy`, require both standard Admin guards and `COMMERCE_POLICY_MANAGE`, and derive actor identity from the authenticated Admin principal:

- `GET /` returns the current typed settings or `data: null` before initialization.
- `POST /initialize` requires the complete settings body and `expectedRevision = 0`; the winner creates revision `1`.
- `PUT /settings` is a complete typed replacement and requires the current positive `expectedRevision`.
- `GET /overrides?from=YYYY-MM-DD&to=YYYY-MM-DD` lists an inclusive range bounded to 366 days and returns the current global revision.
- `PUT /overrides/:localDate` creates or replaces the typed override for one Tehran-local date.
- `DELETE /overrides/:localDate` deliberately removes an existing row; `expectedRevision` is carried in the strict request body.

Times use exact `HH:mm` strings at HTTP boundaries and integer minutes since local midnight in PostgreSQL. Dates use PostgreSQL `date`. Effective mutations take a row lock on the singleton, compare the expected revision, mutate settings/override state, and increment the one global revision in the same transaction. No-op replacements retain the revision. Admin management reads are bounded and N+1-free. COM-02 does not expose a public read route or evaluate Orders.

## Stable errors

| Code                                | HTTP | Displayable message                                      | Safe details                             |
| ----------------------------------- | ---: | -------------------------------------------------------- | ---------------------------------------- |
| `ORDERING_POLICY_UNAVAILABLE`       |  503 | `Ordering is temporarily unavailable. Please try again.` | none                                     |
| `ORDERING_CLOSED`                   |  409 | `Ordering is currently closed.`                          | optional derived `nextTransitionAt` only |
| `ORDER_MINIMUM_QUANTITY_NOT_MET`    |  422 | `The order does not meet the minimum quantity.`          | `minimumQuantity`, `actualQuantity`      |
| `COMMERCE_POLICY_REVISION_CONFLICT` |  409 | `Commerce policy changed. Refresh and try again.`        | current `revision` for authorized Admins |

Missing settings, malformed settings, an invalid relevant override, or an incoherent policy read maps to `ORDERING_POLICY_UNAVAILABLE`; code must not silently invent an always-open default. `ORDERING_CLOSED` is never encoded as out-of-stock, and minimum failure is never mapped to Inventory.

The revision-conflict code is Admin-only. Its current revision detail is safe only after `COMMERCE_POLICY_MANAGE` authorization and is never exposed by the customer submit contract.

## Security, abuse, and observability

- Every Order-create entry point invokes the policy contract; frontend state, client time, timezone, totals, and client-supplied quantity sums are untrusted.
- Quantity DTO/domain validation and server normalization prevent cart-total tampering. Strict Admin DTOs, `COMMERCE_POLICY_MANAGE`, both guards, and principal-derived actors prevent unauthorized or mass-assigned changes.
- Database date uniqueness, enum/field CHECK constraints, expected-revision writes, and fail-closed reads prevent conflicting or malformed overrides from becoming ambiguous.
- A stale public policy display is expected under concurrency; the authoritative submit result and its stable code win.
- Expected closed/minimum failures are normal application outcomes, not error-level incidents. Policy-unavailable and unexpected persistence failures receive safe structured operational telemetry without dumping policy payloads or Admin identity data.

## Audit candidates

AUD-01 should later record safe, revision-linked events:

- `commerce.settings.created`
- `commerce.settings.updated`
- `commerce.schedule_override.created`
- `commerce.schedule_override.updated`
- `commerce.schedule_override.removed`

Record actor id, affected local date where applicable, previous/new revision, and a bounded allowlisted field delta. Do not log request bodies, redundant full policy snapshots, tokens, credentials, or unrelated Admin metadata.

## Deferred and non-goals

- No generic holiday/calendar/rule engine, recurring exceptions, multiple business timezones, Redis authority, BullMQ participation, or frontend implementation.
- Public endpoint shape and optional next-opening derivation are implemented only in a later explicitly scoped task.
- Audit persistence/retention remains AUD-01/DATA-01. COM-01 defines candidates only.
- The pre-existing ORD-03 User/Region default-client gap belongs to `ORD-03A`, after COM-03/DLU-02 dependencies, and is not silently folded into COM-01 or COM-03.
