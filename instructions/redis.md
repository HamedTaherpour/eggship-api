# Redis

Redis is optional ephemeral infrastructure. PostgreSQL remains the source of truth for orders, inventory, payments, financial state, identity, and every other durable business fact.

## Boundary and configuration

- Redis clients belong under `src/infrastructure/redis`. Business modules use an explicit infrastructure capability and must not construct clients directly.
- `REDIS_URL` is optional. When it is blank or absent, the API starts without opening a Redis connection and Redis-backed capabilities are unavailable.
- When `REDIS_URL` is configured, API startup is bounded and tolerant of an unavailable Redis connection. The API remains alive in a degraded state, reports Redis as not ready, and disables Redis-backed capabilities. Worker startup remains mandatory and fails loudly when Redis is unavailable.
- Never log Redis URLs, credentials, connection options, or command payloads.
- Remote development Redis is permitted, but it must be isolated development infrastructure and never a production instance. Development `.env` must never point `REDIS_URL` at production Redis.
- Client resources must close during graceful application shutdown.
- Ordinary unit and e2e suites must not require Redis and must not load a developer `REDIS_URL` from `.env` when `NODE_ENV=test`.
- Real Redis integration uses dedicated `TEST_REDIS_URL` under `pnpm test:integration*` and must never target production Redis.

## Health

Liveness answers whether the process can serve its basic HTTP surface and must not depend on optional Redis. Redis readiness separately reports whether Redis is configured and responding. A deployment that enables Redis-backed capabilities must include Redis readiness in its traffic or worker admission decision.

## Approved uses

Redis may support queues, OTP short-lived state, rate limits, short-lived coordination, and other explicitly approved ephemeral behavior. It must not become an authoritative store or an unreviewed alternative persistence model. Durable identity and refresh sessions belong in PostgreSQL ([authentication.md](authentication.md)).

A cache requires a documented key namespace, ownership, maximum TTL, invalidation behavior, serialization version, failure behavior, and protection against cross-tenant or cross-user leakage. Cache correctness must tolerate eviction, expiration, duplication, and temporary Redis unavailability. Do not cache sensitive data without an explicit security and privacy review. AI agents must not add a cache merely because Redis is available.

Good candidates may include public catalog reads, public blog/content reads, and low-volatility reference or configuration data. CNT-01 does not implement a blog cache. Cached values must not be authoritative for inventory availability, order status, discount eligibility, payment state, permissions, or security decisions.
