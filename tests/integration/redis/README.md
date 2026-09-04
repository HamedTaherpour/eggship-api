# Real Redis / BullMQ integration suite

Opt-in tests under this directory contact disposable Redis through EggShip Redis and queue infrastructure.

```bash
# Requires INTEGRATION_TESTS_ENABLED=true and TEST_REDIS_URL
pnpm test:integration:redis
# or
pnpm test:integration
```

Coverage includes connection/readiness, distinct lifecycle/queue/worker clients, tolerant API degradation when Redis is unreachable, namespaced set/get with TTL and cleanup, AUTH-05 OTP atomic consume/cooldown/rate-limit scripts (including concurrent verify and logical expiry), infrastructure-only BullMQ enqueue/worker completion, retry, failed retention, and custom job-id probes, plus the real WorkerService lifecycle harness for mandatory startup/refusal, correlation/fallback, configured concurrency, retry/failure retention, graceful/forced shutdown, restart recovery, multi-worker distribution, non-HTTP composition, and open-handle cleanup. Keys use `eggship:integration:<runId>:…`; BullMQ queue names use hyphenated `eggship-integration-q-<runId>` (BullMQ forbids `:` in queue names). The suite does not flush shared Redis databases and never targets production Redis.

Mock-only Redis coverage remains unit tests and must not be presented as Redis integration coverage. Policy: [instructions/testing.md](../../../instructions/testing.md).
