# ADR 0003: Redis and BullMQ asynchronous infrastructure

## Status

Accepted

## Context

EggShip needs short-lived infrastructure state and asynchronous execution for slow or retryable work without introducing distributed service complexity. The foundation must support horizontal scaling and PostgreSQL transactional guarantees without making Redis authoritative or inventing business queues before their workflows are approved.

## Decision

Use Redis as optional ephemeral infrastructure and BullMQ as the queue implementation. Keep clients and queue construction behind infrastructure modules. Use a versioned minimal job envelope with explicit correlation context, at-least-once delivery semantics, bounded retries and retention, and per-processor idempotency.

PostgreSQL remains the source of truth. Critical database-to-queue workflows will use a transactional outbox rather than a database mutation followed directly by queue publication. API and worker processes will be separate composition roots that share application modules; the worker entrypoint is deferred until the first approved processor exists.

## Consequences

Deployments using asynchronous capabilities require a reachable Redis service and separate readiness and worker operations. Queue jobs are delivered at least once, so processors must be idempotent and handle duplicate delivery, retries, timeouts, and partial failure. An isolated remote Redis can support development on machines that cannot run Redis locally, but production Redis must never be reused for development or testing. Queue payloads must remain small, versioned, and free of secrets and personal data. Redis availability is an operational concern and must not be confused with durable business state, which remains in PostgreSQL.
