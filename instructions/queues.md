# Queues

BullMQ provides asynchronous delivery over Redis. It is infrastructure for explicitly approved workflows, not a business event model and not a substitute for PostgreSQL transactions.

## Delivery and consistency

- Treat delivery as at least once. Every processor must be safe under retries, duplicate delivery, crashes after side effects, and overlapping workers.
- Define an idempotency key and durable idempotency strategy before introducing a processor with side effects.
- A database mutation followed by `queue.add` is not atomic. Critical workflows must persist an outbox record in the same PostgreSQL transaction as the business change and publish it asynchronously. Do not claim atomic delivery without that boundary.
- Controllers must not wait for slow external side effects that have been approved as asynchronous. Producers still return only the explicitly approved API contract.
- Retry only failures that may succeed later. Permanent validation or business-rule failures must not loop through automatic retries.

## Payload and context

- Use the shared versioned async job envelope and carry `correlationId` explicitly. A worker establishes a fresh request context from the envelope before invoking application code.
- Payloads contain only minimal stable identifiers and the data required to select the operation. Prefer `orderId` or `userId` to snapshots or full entities.
- Never include authentication state, authorization or cookie values, access or refresh tokens, OTPs, passwords, secrets, database URLs, personal contact data, addresses, or full user objects.
- Payload schema changes require compatibility planning for jobs already waiting in Redis.

## Producers and workers

- Queue producers live behind an explicit application-facing contract. Domain and controller code must not depend directly on BullMQ or ioredis.
- Queue names must not contain `:`. BullMQ uses colon as a Redis key separator; `QueueFactory` rejects colon-bearing names.
- Workers are composition roots. They deserialize the envelope, establish context, enforce a processor timeout, and delegate to an application service; business logic does not belong in a processor callback.
- The intended deployment has separately scalable API and worker processes sharing application modules. Do not create a worker entrypoint until at least one approved queue and processor exist.
- Concurrency, lock duration, retries, backoff, retention, payload limits, and timeouts must be deliberately reviewed per queue. Shared defaults are a baseline and may be overridden only with a documented reason.

## Failure visibility

Exhausted failures must remain retained for bounded inspection and emit a structured error containing the queue name, job name, job ID when available, attempt count, correlation ID, and failure timestamp. Alerts and operational replay procedures are required before a critical business queue ships. Logs and job records remain subject to the security and observability redaction rules.
