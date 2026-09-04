# DEP-03: runtime health, migrations, and shutdown

## Migration execution

Schema changes have one explicit owner: `pnpm prisma:migrate:deploy`. The
`migration` Docker target is the release execution path and must run to
successful completion before the API or Worker is admitted. API and Worker
startup never runs migrations implicitly. A migration failure stops promotion;
it is not hidden by starting an application process.

The release order is: build one immutable artifact, run the migration target
against the environment-matched database, start API and Worker from that same
artifact, then admit traffic/work only after readiness succeeds. Rollback and
forward-fix policy remains DEP-06.

## Health and admission

`GET /api/v1/health` is process liveness only and does not contact dependencies.
`GET /api/v1/health/readiness` returns HTTP 200 only when PostgreSQL is
reachable, configured Redis is reachable, and shutdown admission has not
stopped. An omitted Redis URL is reported as `disabled`; it is not a liveness
failure. Failure responses contain only safe dependency state and release
version, never connection strings or provider metadata.

The API keeps listening while a PostgreSQL readiness check fails so the probe
can report `503 not_ready`; invalid configuration still fails during Nest
configuration validation. Shutdown marks admission false before closing the
HTTP application. In-flight requests are allowed to complete according to
the HTTP server close semantics.

## Worker lifecycle

The Worker remains non-HTTP. Its validated startup requires `REDIS_URL` and an
approved processor, and each processor must establish a BullMQ worker before
the Worker is marked ready. Startup failures close any workers already created
and exit non-zero. Shutdown pauses new delivery, drains active jobs up to
`WORKER_SHUTDOWN_TIMEOUT_MS`, force-closes after the bound, and leaves
unfinished jobs available for at-least-once redelivery.

Liara probe, signal, termination grace, and trust-proxy wiring are deployment
configuration decisions and are not inferred here.
