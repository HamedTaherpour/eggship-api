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
publication. Its future claim transaction should select `PENDING` rows in
`createdAt, id` order with row locks and `SKIP LOCKED`, then update durable
state according to its approved at-least-once protocol. Cleanup/retention of
published rows belongs to a later approved DATA/ASY lifecycle task.

NOT-03 uses `order.status.changed` version `1` for the approved customer
Order lifecycle transitions. Its event identity is a deterministic UUID
derived from `(Order.id, status)`, matching the state machine's one-time
lifecycle events. The event is appended through the existing publisher in the
Order transition transaction; no event is marked `PUBLISHED` by NOT-03.
