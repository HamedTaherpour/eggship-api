# ADR 0020: Referral attribution and abuse policy

Status: Accepted by REF-01 architecture review

## Context

EggShip needs to identify which internal acquisition actor brought each newly
registered customer/store account so later Admin reporting can derive store
quality from authoritative Orders. A referral click is not itself a business
event, and rewards are a separate, unapproved concern. The current AUTH-07
flow uses OTP verification followed by an atomic PostgreSQL User/session
completion; referral persistence and registration integration are later tasks.

## Decision

V1 models the conceptual referral source as `VISITOR` or future `USER`, but
implements policy only for `VISITOR`. A Visitor is a business acquisition actor,
not an Admin identity. Admin provisions Visitor referral codes. The exact
choice between Admin-selected and system-generated codes remains unresolved
for REF-02.

The referred entity is the newly registered User/store account; V1 does not
define a store-as-referrer code or link. Visitor-to-User conversion is not
automatic and requires a future identity decision. Future USER referral is a
separate source capability.

The only authoritative attribution moment is successful new customer
registration. The valid code supplied in that registration wins, whether it
came from a link or manual entry. Link visits do not reserve attribution and
V1 does not use first-touch or general marketing last-touch semantics. A link
for an authenticated/already-registered customer has no effect. A supplied
invalid code rejects registration truthfully; absence of a code is valid and
means no attribution.

After registration, referral data is immutable. There is no customer update,
Admin reassignment, later override, or generic update-referrer operation.
Corrections require a separately approved audited workflow. Visitor
deactivation rejects new uses of its code while preserving historical
attributions and analytics; deletion must be evaluated by REF-02 and should be
forbidden where historical references exist. Code reuse remains unresolved,
with non-reuse the safe default.

Registration attribution, User creation, and the valid referral result commit
in one authoritative PostgreSQL transaction. Rollback removes both. Database
uniqueness/conditional-write primitives, not check-then-insert, prevent races;
retries or duplicate completion requests must resolve to one consistent
attribution and never permit conflicting owners. Redis is never the source of
truth.

Codes use a canonical trimmed-uppercase representation over a restricted
URL-safe alphabet, so lookup is case-insensitive and the stored value is
stable. REF-02 still must settle the exact alphabet/ambiguity list and whether
codes are Admin-selected or system-generated. Code reuse after deactivation is
also unresolved, with non-reuse the safe historical-integrity default.

Referral records retain relational identity only. Admin analytics later join
Visitor → attribution → User/store → Orders and OrderLines; they do not store
mutable visitor-value, order-count, sales, or carton aggregates in the
referral domain. Rewards are out of scope and, if later approved, consume the
immutable attribution rather than redefine ownership.

The approved abuse boundary is proportional: registration-only attribution,
invalid-code rejection, inactive-code rejection, existing-customer exclusion,
and the current one-phone/one-account identity rule. V1 adds no click tracking,
fingerprinting, national-ID matching, behavioral scoring, Redis abuse counters,
or speculative self-referral matching. Visitor/customer identity separation
means self-referral is not naturally defined for V1; future USER referral must
decide it explicitly.

## REF-02 clarification

REF-02 settled and implemented the previously open V1 code details: codes use
the canonical alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, are 6–10
characters, may be Admin-selected or system-generated, and are never reused,
including after Visitor deactivation. Historical Visitor references use
`ON DELETE RESTRICT`; deactivation is the lifecycle operation and preserves
the code and attribution history. These clarifications do not change the
registration-only attribution decision above.

## Consequences

REF-02 may proceed with persistence design and migration review, but must settle
code generation/selection, code reuse, historical-reference deletion, minimal
raw-data classification, and the exact registration integration seam. REF-03
must make the existing AUTH-07 completion path accept a code only for a new
registration and preserve the single PostgreSQL transaction boundary. No
schema, migration, endpoint, click state, Admin screen, reward, or tracking
implementation is authorized by this ADR.

Future USER referral remains possible because source type and attribution
ownership are not defined as Visitor-only concepts, while V1 avoids inventing
USER rewards or self-referral rules.
