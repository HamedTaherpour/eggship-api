# Transactional outbox (ASY-01)

`OutboxEvent` is PostgreSQL-authoritative durable event intent. A business
mutation and `OutboxPublisher.publish(envelope, tx)` must receive the same
opaque `TransactionContext`, so both writes commit or roll back together. The
publisher never opens an independent transaction, sends a network request, or
touches Redis/BullMQ.

Each event has a UUID identity, lower-case event type, positive payload schema
version, correlation ID, UTC occurrence time, and a bounded JSON object payload.
The event ID is the idempotency identity: a duplicate ID is rejected by the
primary key, including concurrent inserts. A changed payload must use a new
event ID and/or version rather than silently changing an existing contract.
Payloads are limited to 64 KiB and reject credentials, tokens, OTPs, contact
data, addresses, and full user objects by application validation; JSONB and
database checks provide defense in depth.

ASY-02 owns publication state transitions, retries, crash recovery, and queue
publication. Dispatchers claim bounded batches with `FOR UPDATE SKIP LOCKED`
in `createdAt, id` order, then commit a durable `CLAIMED` lease before doing
Redis I/O. Expired leases are reclaimable. Queue publication uses a stable
`outbox-{eventId}` BullMQ job ID and the shared versioned async envelope; only
confirmed queue acceptance permits a conditional `CLAIMED` → `PUBLISHED`
update. A queue acceptance followed by a process crash before acknowledgement
can therefore be published again after lease recovery, which is intentional
at-least-once behavior and requires idempotent downstream consumers.

Publication failures are returned to `PENDING` with bounded exponential
backoff. Redis is never authoritative and no network call occurs inside a
PostgreSQL transaction. Cleanup/retention of published rows belongs to a later
approved DATA/ASY lifecycle task.

NOT-03 uses `order.status.changed` version `1` for the approved customer
Order lifecycle transitions. Its event identity is a deterministic UUID
derived from `(Order.id, status)`, matching the state machine's one-time
lifecycle events. The event is appended through the existing publisher in the
Order transition transaction; no event is marked `PUBLISHED` by NOT-03.
