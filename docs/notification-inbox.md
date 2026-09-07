# Durable notification inbox (NOT-01)

`Notification` is the PostgreSQL-authoritative customer inbox record. It is
owned by exactly one `User` and remains durable regardless of whether a later
push-delivery attempt succeeds. NOT-01 does not create outbox events, enqueue
jobs, send push notifications, or provide HTTP endpoints.

The initial approved category is `ORDER_STATUS`, with `ORDER_TRANSITION` or
`SYSTEM` provenance. New categories are additive Prisma enum migrations after
approval; arbitrary client-controlled type strings are not accepted.

Title and body are bounded customer-facing text. `payload` is a bounded JSON
object for minimized, customer-safe structured data only. It must not contain
credentials, tokens, OTP values, contact identifiers, or internal diagnostics.
Navigation/destination is intentionally not a separate persistence field in
NOT-01; a future approved payload contract may add safe navigation data.

`readAt` is nullable and is the sole read-state authority. Owner-scoped reads
and the idempotent mark-read primitive always include `userId` in the database
predicate. The repository accepts the existing opaque `TransactionContext`, so
NOT-03 can create a notification in the caller's transaction without coupling
this module to Prisma, BullMQ, or Redis.

Notifications accumulate as durable customer-facing history. Retention,
cleanup, archival, and deletion rules belong to the Data Lifecycle phase
(DATA-01/DATA-02); NOT-01 does not invent a duration or cleanup job.

## Order-status generation (NOT-03)

NOT-03 owns generation for the approved `CONFIRMED`, `SHIPPED`, `DELIVERED`,
and `CANCELLED` transitions. The winning Order transition writes one
`ORDER_STATUS` / `ORDER_TRANSITION` inbox record and one ASY-01 outbox event in
the same caller transaction. Replays and invalid transitions do neither.
The notification payload and outbox payload contain only the Order UUID and
new status; cancellation reasons, customer contact data, addresses, and full
Order entities are excluded. Push delivery, claiming, retries, and Redis /
BullMQ processing remain outside NOT-03.

## Customer inbox API (NOT-02)

Authenticated `USER` principals can use these `/api/v1/notifications`
endpoints. The owner is always derived from the access-token principal; no
request field selects a customer.

| Method  | Path                          | Purpose                                                                                                               |
| ------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/notifications`              | Paginated list, `page`/`pageSize` only (defaults 1/20, max page size 100), newest first with ascending `id` tie-break |
| `GET`   | `/notifications/unread-count` | PostgreSQL-derived unread count                                                                                       |
| `PATCH` | `/notifications/:id/read`     | Idempotently mark one owned notification read                                                                         |
| `POST`  | `/notifications/read-all`     | Idempotently mark all owned unread notifications read                                                                 |

Customer responses omit `userId`, `source`, and persistence diagnostics. All
responses use `Cache-Control: no-store`. Missing and other-owner notification
ids return the same `NOTIFICATION_NOT_FOUND` response. Cookie-authenticated
read mutations remain covered by the global AUTH-10 CSRF guard; Bearer clients
retain the accepted native-client behavior.

## Push installations and delivery (NOT-04)

`PushInstallation` is an independently owned User installation, identified by
a client-generated opaque UUID. Its provider token is sensitive write-only
material. Registration is idempotent, active cross-user reassignment is
rejected, and revoked/invalidated installations can be explicitly reactivated
by their stable installation identity. `PUT
/notifications/installations/:installationId` registers and `DELETE` revokes;
neither endpoint returns the provider token. Eligibility requires User
`isActive`, installation `ACTIVE`, and `permissionGranted`.

`POST /auth/logout-all` revokes the User's active installations as well as all
auth sessions. These are separate PostgreSQL operations and are not promised
as one shared transaction. Current-device logout cannot identify an
installation under the existing auth contract, so it clears/revokes the auth
session only; clients that need device suppression call the explicit DELETE
endpoint.

`NotificationDelivery` is durable delivery intent/state, not the inbox source
of truth. Its unique identity is `(notificationId, installationId, channel)`.
States are `PENDING`, `SENDING`, `ACCEPTED`, `FAILED`, `INVALIDATED`, and
`SUPPRESSED`. `ACCEPTED` never means displayed, received, opened, or read.
Only typed internal destinations are allowed; V1 supports `{ type: "ORDER",
id }`, and the frontend constructs the route. NOT-05 owns provider invocation,
workers, retries, and replay. DATA-02 owns retention and cleanup policy.

NOT-06 adds explicit nullable `PushInstallation.channel` and `.os` metadata.
The fields are required and enum-validated on new registration, while legacy
rows remain `NULL` because historical platform values cannot be inferred
truthfully. Re-registration updates metadata on the existing installation row
and does not create a duplicate. Metadata-specific targeting is user-aware:
active Android web installations qualify only when the same active User has no
active Android native installation. The query is one set-based relation query,
not per-installation or per-user N+1 work.
