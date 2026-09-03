# Referrals and visitor attribution

EggShip V1 referral behavior is acquisition attribution, not a rewards or
marketing-tracking system. The accepted architecture is recorded in [ADR
0020](../docs/adr/0020-referral-attribution-and-abuse-policy.md).

## V1 objective and scope

The V1 objective is to identify which internal acquisition `Visitor` acquired
each newly registered customer/store account so future Admin analytics can
join:

```text
Visitor → immutable attribution → User/store → Orders → order lines and quantities
```

`Visitor` is a business/acquisition actor, distinct from the customer `User`.
Admin creates and manages Visitors and provisions their referral codes, but a
Visitor is not thereby an Admin identity. The conceptual source types are
`VISITOR` and future `USER`; only `VISITOR` attribution is in V1. User referral
rewards, commissions, credits, discounts, eligibility, and settlement are not
defined.

The referred entity in V1 is the newly registered User/store account. A store
does not independently act as a referrer or receive a separate store code/link
model. Future User referral and any store-as-source capability require their
own approved source/ownership rules. V1 also defines no automatic
Visitor-to-User conversion: the identities remain separate unless a later
approved identity design says otherwise.

## Attribution contract

Attribution is created only when a new customer successfully completes
registration. A link visit, code resolution, or temporary transport through a
frontend flow creates no durable attribution. The valid code actually supplied
for that successful registration wins; earlier link visits do not reserve a
claim and V1 is neither first-touch nor general marketing last-touch.

A code may arrive from a referral link or manual registration entry. A supplied
code is validated during registration. An invalid supplied code rejects the
registration with a truthful validation/domain error; it must never silently
become `null`. No supplied code remains valid and produces `null` attribution.

Referral links route toward customer authentication/registration. Authenticated
or already-registered customers do not enter new-customer registration because
of a link, and the link has no attribution effect. Temporary code transport is
a frontend concern unless the existing registration flow proves a backend
handoff is necessary; server-side click/session attribution is not approved.

## REF-04 Admin read contract

REF-04 is read-only Admin visitor and referral administration. It uses the
dedicated `VISITOR_READ` permission; `CUSTOMER_READ` is not reused merely
because referred Users are displayed. V1 grants `VISITOR_READ` only to
`SUPER_ADMIN` pending legacy capability evidence.

The surface is `GET /api/v1/admin/visitors` (bounded pagination, search by
visitor name/referral code, explicit `isActive`/`hasAttributions` filters, and
allowlisted sorting), `GET /api/v1/admin/visitors/:id` (minimized visitor
identity, state, timestamps, and durable attribution count), and
`GET /api/v1/admin/visitors/:id/referrals` (bounded immutable attribution
evidence joined to the existing User/customer identity). Evidence contains
only attribution id, visitor id, referred customer id/phone/active state,
source, historical referral code, and attribution timestamp. All responses are
`Cache-Control: no-store`, explicit DTOs, and OpenAPI-documented. No route
mutates/reassigns attribution, deletes visitors, exports data, exposes
credentials/session data, tracks clicks, fingerprints devices, or introduces a
Store entity or reward semantics.

Only the new-registration path may accept a referral code. After registration,
the customer cannot add or change a referrer, opening another link has no
effect, and Admin cannot reassign attribution. Any future correction requires
a separately approved, audited workflow and must not weaken the immutable V1
record.

Under the current identity model, one canonical phone number is one EggShip
store/customer account. Two independent accounts with different phone numbers
may each have valid attribution. V1 does not attempt beneficial-owner,
national-ID, device, or IP deduplication. Visitor/customer identities are
separate, so V1 self-referral has no natural identity match; no speculative
matching mechanism is introduced. Future USER referral must define its own
self-referral rule before implementation.

## Visitor lifecycle and code policy

Deactivating a Visitor prevents its code from being used for new registration
attribution. It does not delete, rewrite, detach, or hide historical
attributions, referred Users, or historical analytics. Deactivation is
preferred to deletion where historical references exist; REF-02 must choose a
database-enforced deletion policy rather than relying on application checks.

Referral codes must be unique, stable, URL/manual-entry safe, consistently
normalized, indexed for lookup, and reasonably resistant to accidental
ambiguity and typos. REF-02 should use trimmed uppercase normalization over a
restricted URL-safe alphabet, making lookup case-insensitive while preserving
one canonical stored representation. Admin may provide a preferred code or let
the system generate one. Codes are 6–10 characters from
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (excluding O/0/I/1); generated codes use
10 characters and retry boundedly on a database collision. Codes are globally
unique and never reused, including after deactivation. Reactivation preserves
the same code.

## Persistence, authority, and analytics

REF-02 must preserve relational identity between the Visitor, code, immutable
attribution, and User/store without copying order totals, order counts, carton
quantities, or other mutable value metrics into referral records. Future Admin
analytics derive those measures from authoritative Order and OrderLine data,
and continue to work after Visitor deactivation.

PostgreSQL is the source of truth for Visitor ownership, code validity, and
attribution. Redis may transport temporary application state but must not own
referral identity or durable attribution. Registration, User creation, and
valid referral attribution must commit in the same authoritative PostgreSQL
transaction. A rollback leaves neither the successful registration nor its
attribution. REF-02/REF-03 must use database uniqueness/conditional writes or
equivalent transaction-safe primitives; check-then-insert is insufficient.
REF-02 uses a dedicated `ReferralAttribution` row with unique `userId`, Visitor
`RESTRICT` FKs, and no update/delete API; REF-03 owns future capture/link
behavior.

Registration locks the canonical Visitor row with PostgreSQL `FOR UPDATE` before
checking `isActive` and inserting attribution. Activate/deactivate commands
update that same row and therefore serialize with registration. If registration
gets the lock first, it is the earlier legal serial history and deactivation
commits afterward; if deactivation commits first, registration locks the row
with `isActive = false` and rejects. Visitor code identity is also protected by
an additive database check and an update trigger; lifecycle commands only change
`isActive`.

The attribution record is historical data: no customer edit, Admin edit,
reassignment, or later override is allowed. Rewards, if approved later, must
consume this immutable attribution and must not redefine acquisition ownership.

## Security, privacy, and explicit exclusions

The V1 abuse posture is proportional: registration-only attribution, immutable
ownership, rejection of invalid supplied codes, inactive-code rejection,
existing-customer exclusion, and the current one-phone/one-account rule. IP or
device fingerprinting, national-ID matching, behavioral fraud scoring, Redis
abuse counters, click tracking, click history, server-side visitor sessions,
monetary rewards, commissions, and referral aggregates are out of scope.
Residual limitations are accepted: a person may use multiple independently
registered phone accounts, and no speculative fraud signal is inferred. Visitor/referral
classification and lifecycle principles are recorded in [data-lifecycle.md](../docs/data-lifecycle.md);
retention durations remain **UNRESOLVED**.

REF-02 defines the minimal relational schema, ownership/provenance,
normalization, uniqueness, deletion behavior, duplicate/idempotency behavior,
and privacy classification. REF-03
must integrate the valid-code decision into the existing new-registration
transaction without adding a generic post-registration referral update path.
