# ADR 0025: Deployment runtime architecture

## Status

Proposed for operations review; Human + ChatGPT conceptual architecture approved

## Context

EggShip is a modular monolith with an HTTP API, asynchronous infrastructure, and
no approved business processor for the current worker composition root. DEP-01
must define runtime and environment boundaries without turning undocumented
Liara behavior into an architecture decision or provisioning infrastructure.

## Decision

### API and Worker topology

- API and Worker are independent runtime processes and may scale independently.
- Both are built from one immutable release artifact/image produced from the
  same commit. Startup commands are `node dist/main.js` and
  `node dist/worker.js` respectively.
- The Worker is non-HTTP and is not deployed until an approved business
  processor exists. The current fail-closed empty-Worker behavior is intentional.
- Worker replicas use bounded per-process `WORKER_CONCURRENCY`. DEP-01 chooses
  no replica count or production concurrency value.
- API and database-using Workers share the same environment-scoped PostgreSQL
  because EggShip remains a modular monolith. Per-process pool budgets and
  credentials are DEP-02 concerns.

### PostgreSQL, Redis, and object storage

- PostgreSQL is authoritative for durable business state.
- Start with one environment-scoped Redis resource shared by API Redis-backed
  ephemeral capabilities, BullMQ producers, and BullMQ Workers. Redis is never
  authoritative; separate resources require operational or capacity evidence and
  a later decision.
- Object bytes use the existing `StorageProvider` and environment-scoped object
  storage. Important business state and files do not depend on local disk.
- Connections are explicit through `DATABASE_URL`, `REDIS_URL`, and the existing
  `STORAGE_*` settings (with Worker Redis required by its runtime contract).

### Environment isolation and release identity

- Staging and production have separate PostgreSQL, Redis, object storage, and
  secrets/configuration. Development and integration-test targets remain
  separately guarded by existing environment and `TEST_*` policies.
- API and Worker receive the same `APP_VERSION`, `GIT_SHA`, and release identity
  from the immutable artifact. Version skew is observable through structured
  release metadata; rollback/skew policy belongs to DEP-06.
- Production logs remain structured Pino JSON on stdout/stderr with existing
  redaction, correlation, and release metadata.

### Migration, health, and failure boundaries

- Production schema migration has exactly one explicit owner/step using
  `prisma migrate deploy`. Neither API nor Worker startup runs migrations
  implicitly. The exact Liara execution mechanism is deferred to deployment work
  after provider verification.
- API liveness remains process-only in DEP-01. Readiness, dependency admission,
  HTTP draining, Worker readiness, and failed-start hardening belong to DEP-03.
- Worker failure must not make the API unavailable. PostgreSQL failure prevents
  API readiness. Redis failure fails closed for Redis-dependent capabilities and
  prevents Worker readiness/startup as appropriate.
- Express `trust proxy` is intentionally unspecified until Liara's actual proxy
  topology and forwarded-header behavior are verified.

## Provider-specific verification

The conceptual architecture does not depend on undocumented Liara facts. DEP-02
and DEP-03 planning must verify and record evidence for. DEP-02's verified
resource/configuration contract is recorded in
[DEP-02 infrastructure contract](../dep-02-infrastructure-contract.md):

- separate Liara applications versus independent process types;
- non-HTTP Worker support and custom commands from one artifact;
- migration/release-job execution;
- readiness/health probes and graceful termination/signals;
- private networking and PostgreSQL/Redis TLS/connectivity;
- Liara Object Storage's official S3-compatible HTTPS endpoint, private
  buckets, bucket-scoped credentials, and presigned-access requirement;
- secret-management behavior;
- forwarded-header/proxy topology, including exact trust-proxy hops; and
- structured stdout log collection.

No Liara resource is provisioned and no deployment is implied by this ADR.

## Consequences

This preserves modular-monolith transaction boundaries while allowing API and
Worker capacity to evolve independently. Redis outages remain capability and
worker-readiness concerns rather than durable-data loss. A single artifact makes
release identity comparable across processes, while DEP-06 owns compatibility,
rollback, and skew handling. Provider verification remains an explicit
operational prerequisite for deployment planning, not an unstated DEP-01 fact.

## References

- [ADR 0001: Modular monolith](0001-modular-monolith.md)
- [ADR 0002: PostgreSQL and Prisma](0002-postgresql-prisma.md)
- [ADR 0003: Redis and BullMQ asynchronous infrastructure](0003-redis-bullmq.md)
- [Environment instructions](../../instructions/environment.md)
- [Queue instructions](../../instructions/queues.md)
- [Release instructions](../../instructions/releases.md)
