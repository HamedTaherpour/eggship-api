# Real Redis / BullMQ integration suite

Opt-in tests under this directory contact disposable Redis through EggShip Redis and queue infrastructure.

```bash
# Requires INTEGRATION_TESTS_ENABLED=true and TEST_REDIS_URL
pnpm test:integration:redis
# or
pnpm test:integration
```

Coverage includes connection/readiness, namespaced set/get with TTL and cleanup, AUTH-05 OTP atomic consume/cooldown/rate-limit scripts (including concurrent verify), and an infrastructure-only BullMQ enqueue/worker completion probe with correlation metadata. Keys and queue names include a unique test-run id. The suite does not flush shared Redis databases and never targets production Redis.

Mock-only Redis coverage remains unit tests and must not be presented as Redis integration coverage. Policy: [instructions/testing.md](../../../instructions/testing.md).
