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
