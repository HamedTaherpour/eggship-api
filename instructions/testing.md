# Testing

EggShip separates fast local suites from opt-in real-infrastructure suites. Tests must never claim PostgreSQL or Redis integration unless a real service was contacted.

## Test taxonomy

| Category                       | What it proves                                              | Infrastructure                                                                                 |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Unit**                       | Isolated application and infrastructure rules               | None                                                                                           |
| **Lightweight e2e**            | Observable Nest HTTP behavior                               | None required; adapters may be replaced when the test is about HTTP rather than persistence    |
| **Infrastructure integration** | Prisma/PostgreSQL, Redis, or BullMQ against real services   | Dedicated `TEST_*` resources; explicit opt-in                                                  |
| **Domain integration**         | Future business behavior with real persistence              | Same real-infrastructure foundation                                                            |
| **Concurrency**                | Future simultaneous-operation correctness                   | Real infrastructure; may require committed rows and separate connections                       |
| **Load/performance**           | Future capacity/latency against a deployed test/staging API | Not unit-test process instances; k6 or an approved equivalent only when measurable flows exist |

Do not call lightweight e2e "database integration testing." Do not label mocked Redis or Prisma coverage as infrastructure integration.

Canonical locations:

- Unit: `src/**/*.spec.ts` and integration-guard specs under `tests/integration/**/*.spec.ts`
- Lightweight e2e: `test/**/*.e2e-spec.ts`
- Infrastructure integration: `tests/integration/**/*.integration-spec.ts`
- Future load: `tests/performance/`

## Fast default suite

```bash
pnpm test
pnpm test:e2e
```

These commands:

- force `NODE_ENV=test`;
- ignore developer `.env` files;
- use synthetic non-routable database URLs;
- must not require Docker, network PostgreSQL, or Redis.

An unavailable local PostgreSQL or Redis instance is not justification for replacing meaningful integration coverage with mocks. Keep mocks in unit/lightweight e2e layers; prove persistence and queue semantics in the real-infrastructure suite.

## Real infrastructure suite

```bash
pnpm test:integration
pnpm test:integration:postgres
pnpm test:integration:redis
pnpm test:integration:storage
```

Requirements:

- `INTEGRATION_TESTS_ENABLED=true`
- `TEST_DATABASE_URL` for PostgreSQL suites
- `TEST_REDIS_URL` for Redis/BullMQ suites
- `TEST_STORAGE_*` for `pnpm test:integration:storage` only (never part of ordinary CI `all`)
- never silently reuse developer `DATABASE_URL` / `REDIS_URL`

Missing configuration for an explicitly invoked integration command must fail clearly. Do not report a successful real-infrastructure suite when no service was contacted.

### Dedicated TEST resources

| Variable                        | Purpose                                                      |
| ------------------------------- | ------------------------------------------------------------ |
| `TEST_DATABASE_URL`             | Disposable/dedicated integration PostgreSQL                  |
| `TEST_REDIS_URL`                | Disposable/dedicated integration Redis                       |
| `TEST_STORAGE_*`                | Opt-in S3-compatible storage suite (never production bucket) |
| `INTEGRATION_TESTS_ENABLED`     | Explicit opt-in (`true`)                                     |
| `INTEGRATION_ALLOW_DESTRUCTIVE` | Extra opt-in for truncate/reset-style operations             |

Remote dedicated TEST PostgreSQL/Redis is supported for local opt-in, staging, or hosts without service containers. Those resources must never be shared with production.

### Destructive-test safety

Integration tests may insert, delete, truncate, or migrate against TEST resources. They must refuse to run unless `INTEGRATION_TESTS_ENABLED=true`. Truncate/reset-style helpers must also require `INTEGRATION_ALLOW_DESTRUCTIVE=true`. Do not rely only on hostname guessing. Explicit production-marked DNS labels (`prod`, `production`, and bounded variants) are rejected when they can be identified reliably.

### Schema preparation

Prefer `prisma migrate deploy` against `TEST_DATABASE_URL` so tests exercise the deployment-relevant migration path. Do not use `prisma db push` as the canonical integration strategy. The repository may have an empty business migration history; that state must be handled honestly rather than inventing migrations for tests.

### Isolation and parallelism

Use unique test-run IDs, Redis key prefixes, queue names, and fixture identifiers. Prefer scoped cleanup over flushing a shared Redis database. Do not force every future test into one transaction if that prevents concurrency testing; concurrency suites may need committed rows and separate connections.

### Logging

Integration failures may include safe host/database metadata. Never log passwords, full URLs with credentials, tokens, or Redis credentials. Follow [observability](observability.md) redaction rules.

### CI and remote execution

Ordinary CI quality jobs remain infrastructure-free. Real integration runs in a separate GitHub Actions workflow with ephemeral PostgreSQL/Redis service containers and synthetic non-production credentials, or against remote dedicated TEST resources. Docker is not required on developer laptops; GitHub-hosted service containers are independent of that rule.

### Future concurrency scenarios

When domain modules exist, concurrency suites should use this foundation for cases such as inventory oversell prevention, refresh-token reuse under concurrent rotation, order idempotency-key races, discount usage limits, and BullMQ duplicate delivery with idempotent worker effects. Do not invent those business tests before their roadmap tasks.

### Future load testing

Load testing is different from integration testing. Future load tests run against a deployed test/staging API. Do not add k6 until measurable flows exist and a roadmap task requires it.

## Practices

- External providers may be represented by deterministic fake adapters in unit/lightweight e2e layers.
- Bug fixes require regression tests when practical.
- Test names describe behavior and outcome.
- Critical paths need meaningful assertions, not coverage-only tests.
