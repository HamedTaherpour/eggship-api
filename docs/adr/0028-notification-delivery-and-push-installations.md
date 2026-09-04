# ADR 0028: Notification delivery abstraction and push installations (NOT-04)

Status: Accepted for NOT-04 implementation.

`Notification` is the durable user-facing inbox fact. `NotificationDelivery`
is separate delivery state, keyed uniquely by notification, installation, and
channel. V1 channels are `IN_APP` and `WEB_PUSH`; `ACCEPTED` means only that a
future provider accepted the message, never that a device displayed or a user
read it. `Notification.readAt` remains application read truth.

`PushInstallation` belongs to `User`, not `AuthSession`. Clients generate a
strict opaque UUID `installationId`; provider tokens are recoverable,
security-sensitive material and are never returned, logged, audited, placed
in outbox/queue/failure records, or included in exceptions. Installations are
`ACTIVE`, `REVOKED`, or `INVALIDATED` and are retained for history.

Registration is idempotent for the same User and installation. An active
installation or provider token cannot be assigned to another User. A revoked
or invalidated installation may be explicitly reactivated by its stable
installation identity, atomically, when registration is valid. PostgreSQL
uniqueness plus serializable registration transactions protect this boundary.

Push eligibility requires an active installation, browser/OS permission, and
an active User. Logout-all revokes all active installations. The current
implementation performs session and installation revocation as separate
PostgreSQL operations and therefore does not promise atomicity across those
two effects. Current-device logout does not implicitly revoke an installation
because the existing auth logout contract does not identify one; clients use
the explicit installation DELETE contract. Session expiry does not alter
installation history.

The `PushDeliveryProvider` port is provider-neutral. Firebase/FCM types,
credentials, diagnostics, adapters, provider calls, workers, retries, and
external-side-effect replay belong to NOT-05. Retention and cleanup belong to
DATA-02; no duration is invented here.

## NOT-05 implementation addendum

FCM is the V1 infrastructure adapter behind the provider-neutral port. BullMQ
owns automatic retry scheduling; PostgreSQL `NotificationDelivery` state,
attempts, claim token, and bounded lease are authoritative. The initial
eligible installation set is materialized once per Notification, so retry and
ASY-04 replay never add installations registered later. Eligibility is checked
again immediately before each provider call; ineligible rows become
`SUPPRESSED`, and provider-confirmed invalid tokens become `INVALIDATED` while
the installation history is retained. Both are handled terminal outcomes and
do not create ASY-04 failures.

EggShip guarantees one durable logical delivery identity per
`notificationId × installationId × channel`, not exactly-once external push.
If FCM accepts a message and the worker crashes before recording `ACCEPTED`, a
stale-lease reclaim can send a duplicate. No verified FCM idempotency primitive
is assumed. `ACCEPTED` means provider acceptance only. `DATA-02` remains the
owner of retention. Real FCM reachability and Liara/Iran staging proof are
mandatory before production release and are not claimed by local tests.
