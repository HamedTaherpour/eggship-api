# Environment workflow

This policy defines EggShip API runtime environments, local configuration, infrastructure safety, and developer setup. Deployment automation for Liara is out of scope until an explicit roadmap task.

## Environment model

EggShip distinguishes **Node runtime environment** from **deployment tier**.

### Node runtime (`NODE_ENV`)

Validated centrally in `src/config/environment.validation.ts`. Allowed values:

| Value         | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `development` | Local or remote development against non-production infrastructure       |
| `test`        | Automated tests and OpenAPI generation defaults                         |
| `production`  | Production-like Node runtime (logging, OpenAPI defaults, optimizations) |

Do not set `NODE_ENV=staging`. Existing Nest/Node tooling expects the standard Node values above.

### Deployment tier (conceptual)

| Tier             | How it is represented today                                                    | Infrastructure                                    |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| Local            | Developer machine; usually `NODE_ENV=development` with a local `.env`          | Dedicated development PostgreSQL; optional Redis  |
| Test             | `NODE_ENV=test` forced by Jest/OpenAPI setup; `.env` file loading disabled     | Synthetic non-routable URLs for ordinary suites   |
| Integration test | Explicit `pnpm test:integration*`; opt-in `TEST_*` variables only              | Dedicated disposable TEST PostgreSQL and/or Redis |
| Staging          | Future Liara staging app; typically `NODE_ENV=production` plus staging secrets | Separate staging PostgreSQL and Redis             |
| Production       | Future Liara production app; `NODE_ENV=production` plus production secrets     | Separate production PostgreSQL and Redis          |

Staging and production are **deployment tiers**, not additional `NODE_ENV` values. They must never share database or Redis credentials.

### `DEPLOYMENT_ENV` decision

EggShip does **not** introduce a `DEPLOYMENT_ENV` (or equivalent) variable in this foundation.

Reasons:

- Ordinary safety for tests is enforced by ignoring `.env` when `NODE_ENV=test` and by synthetic URLs, not by a second env axis.
- Staging OpenAPI exposure is already controlled with optional `OPENAPI_ENABLED`.
- Hostname guessing against Liara or other hosts is unreliable and forbidden.
- Without an explicit, reviewed resource-tier marker scheme, a deployment-tier variable would not reliably prevent pointing `DATABASE_URL` / `REDIS_URL` at the wrong system.

Revisit a typed deployment-tier variable only when Liara staging/production work needs it for observability, admission, or OpenAPI policy—and design it so it cannot be confused with `NODE_ENV`.

## Supported variables

Nest runtime variables are accepted only through `validateEnvironment`. Do not invent undocumented Nest runtime names.

| Variable                                              | Required | Secret | Applies to            | Purpose                                                                      | Safe example / notes                                                                                |
| ----------------------------------------------------- | -------- | ------ | --------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                            | Yes      | No     | All runtimes          | Node runtime mode                                                            | `development`                                                                                       |
| `PORT`                                                | Yes      | No     | All runtimes          | HTTP listen port (1–65535)                                                   | `3000`                                                                                              |
| `DATABASE_URL`                                        | Yes      | Yes    | App start, Prisma CLI | PostgreSQL connection URL (`postgresql://` or `postgres://`)                 | Placeholder only in docs; never commit real credentials                                             |
| `DATABASE_POOL_MAX`                                   | No       | No     | App/worker DB pool    | Connections per process (default `10`, range `1`–`50`)                       | Budget across every API and worker replica; integration tests override to `32`                      |
| `DATABASE_CONNECTION_TIMEOUT_MS`                      | No       | No     | App/worker DB pool    | Pool acquisition timeout ms (default `5000`, range `250`–`30000`)            | Keep bounded so saturation fails promptly                                                           |
| `DATABASE_IDLE_TIMEOUT_MS`                            | No       | No     | App/worker DB pool    | Idle connection lifetime ms (default `30000`, range `1000`–`300000`)         | Avoid retaining oversized idle pools                                                                |
| `APP_VERSION`                                         | Yes      | No     | All runtimes          | Semantic application version for logs, health, OpenAPI `info.version`        | Must be SemVer; local example `0.1.0`. Deployments inject the release version.                      |
| `GIT_SHA`                                             | Yes      | No     | All runtimes          | Source revision metadata for logs                                            | Local example `local`. Deployments inject the build commit SHA; do not hand-maintain in production. |
| `JWT_ACCESS_SECRET`                                   | Yes      | Yes    | Auth token signing    | HS256 secret for access tokens (≥ 32 non-trivial characters)                 | Synthetic local secret only; never commit production values                                         |
| `JWT_ACCESS_TTL`                                      | No       | No     | Auth token lifetime   | Access token TTL in seconds (default `900`)                                  | Configurable; not a product-immutable constant                                                      |
| `REFRESH_TOKEN_TTL`                                   | No       | No     | Auth session lifetime | Refresh session TTL in seconds (default `2592000`)                           | Used by session issuance; opaque refresh tokens are not JWT-signed                                  |
| `OTP_PROVIDER`                                        | No\*     | No     | OTP delivery          | `development` \| `kavenegar`                                                 | Defaults: development (dev/test), kavenegar (production). Production forbids development.           |
| `OTP_HASH_SECRET`                                     | Yes      | Yes    | OTP digests           | HMAC key for OTP digests (≥ 32 non-trivial characters)                       | Distinct from JWT secret; never commit production values                                            |
| `CSRF_SECRET`                                         | Yes      | Yes    | Browser CSRF tokens   | Dedicated HMAC key (≥ 32 non-trivial characters)                             | Distinct from JWT and OTP secrets; never commit production values                                   |
| `CSRF_ALLOWED_ORIGINS`                                | Yes      | No     | Browser origin policy | Comma-separated canonical http(s) origins                                    | Explicit local origins in development/test; non-empty strict allowlist in production                |
| `OTP_DEV_CODE`                                        | Cond.    | No     | Dev OTP               | Six digits when `OTP_PROVIDER=development` (default `111111`)                | Adapter/config only; never a production bypass                                                      |
| `OTP_TTL_SECONDS`                                     | No       | No     | OTP challenge         | Challenge TTL seconds (default `300`, max `900`)                             | Initial AUTH-05 starting point                                                                      |
| `OTP_MAX_ATTEMPTS`                                    | No       | No     | OTP challenge         | Max wrong verifies (default `5`)                                             | Challenge invalidated at limit                                                                      |
| `OTP_RESEND_COOLDOWN_SECONDS`                         | No       | No     | OTP abuse             | Resend cooldown seconds (default `60`)                                       | Per canonical phone                                                                                 |
| `OTP_PHONE_WINDOW_SECONDS` / `OTP_PHONE_WINDOW_LIMIT` | No       | No     | OTP abuse             | Phone request window (default `3600` / `5`)                                  | SMS cost protection                                                                                 |
| `OTP_IP_WINDOW_SECONDS` / `OTP_IP_WINDOW_LIMIT`       | No       | No     | OTP abuse             | IP request window (default `3600` / `20`)                                    | Requires trusted IP at HTTP boundary                                                                |
| `OTP_VERIFICATION_GRANT_TTL_SECONDS`                  | No       | No     | OTP handoff           | Post-verify grant TTL seconds (default `600`, max `900`)                     | Short-lived Redis grant after successful OTP verify                                                 |
| `KAVENEGAR_API_KEY`                                   | Cond.    | Yes    | Kavenegar             | Required when `OTP_PROVIDER=kavenegar`                                       | Never commit                                                                                        |
| `KAVENEGAR_OTP_TEMPLATE`                              | Cond.    | No     | Kavenegar             | Verify/lookup template name                                                  | Required with kavenegar provider                                                                    |
| `REDIS_URL`                                           | No       | Yes    | Optional Redis        | Redis connection (`redis://` or TLS `rediss://`)                             | Omit or leave blank to disable Redis; OTP operations fail closed without Redis                      |
| `OPENAPI_ENABLED`                                     | No       | No     | HTTP docs exposure    | `true`/`false` override for `/docs` and `/docs-json`                         | Unset uses `NODE_ENV` defaults                                                                      |
| `STORAGE_PROVIDER`                                    | No\*     | No     | Object storage        | `memory` \| `s3`                                                             | Defaults: memory (dev/test), s3 (production). Production forbids memory.                            |
| `STORAGE_ENDPOINT`                                    | Cond.    | No     | S3-compatible API     | Required when `STORAGE_PROVIDER=s3`                                          | Example shape only: `https://storage.example.invalid`                                               |
| `STORAGE_REGION`                                      | Cond.    | No     | S3-compatible API     | Required when `STORAGE_PROVIDER=s3`                                          | Provider region string; Liara often uses a sentinel such as `us-east-1`                             |
| `STORAGE_BUCKET`                                      | Cond.    | No     | S3-compatible API     | Required when `STORAGE_PROVIDER=s3`                                          | Never commit a production bucket name as a secret; still do not use production buckets in dev       |
| `STORAGE_ACCESS_KEY`                                  | Cond.    | Yes    | S3-compatible API     | Required when `STORAGE_PROVIDER=s3`                                          | Never commit                                                                                        |
| `STORAGE_SECRET_KEY`                                  | Cond.    | Yes    | S3-compatible API     | Required when `STORAGE_PROVIDER=s3`                                          | Never commit                                                                                        |
| `STORAGE_PUBLIC_BASE_URL`                             | Cond.    | No     | Public object URLs    | Required for s3; optional for memory (default `https://media.local.invalid`) | Must be http(s) without embedded credentials                                                        |
| `STORAGE_FORCE_PATH_STYLE`                            | No       | No     | S3-compatible API     | `true`/`false` (default `true`)                                              | Path-style is typical for S3-compatible endpoints                                                   |
| `MEDIA_MAX_FILE_BYTES`                                | No       | No     | Media uploads         | Per-file cap (default `5242880`)                                             | Hard maximum 20 MiB                                                                                 |
| `MEDIA_MAX_FILES_PER_BATCH`                           | No       | No     | Media uploads         | Max files in one request (default `10`)                                      | Hard maximum 20                                                                                     |
| `MEDIA_MAX_BATCH_BYTES`                               | No       | No     | Media uploads         | Aggregate cap (default `26214400`)                                           | Hard maximum 100 MiB                                                                                |
| `MEDIA_UPLOAD_CONCURRENCY`                            | No       | No     | Media uploads         | Internal parallel puts (default `3`)                                         | Hard maximum 8; not a public API                                                                    |

\* `OTP_PROVIDER` and `STORAGE_PROVIDER` may be omitted; defaults depend on `NODE_ENV` as above. Production forbids `OTP_PROVIDER=development` and `STORAGE_PROVIDER=memory`.

### Integration-suite variables (not Nest runtime config)

These are consumed by `pnpm test:integration*` and are **not** part of `validateEnvironment`. Do not point them at production. Do not treat developer `DATABASE_URL` / `REDIS_URL` as substitutes.

| Variable                        | Required for integration  | Secret | Purpose                                           |
| ------------------------------- | ------------------------- | ------ | ------------------------------------------------- |
| `INTEGRATION_TESTS_ENABLED`     | Yes (`true`)              | No     | Explicit opt-in for the real-infrastructure suite |
| `TEST_DATABASE_URL`             | PostgreSQL suites         | Yes    | Dedicated disposable integration PostgreSQL       |
| `TEST_REDIS_URL`                | Redis/BullMQ suites       | Yes    | Dedicated disposable integration Redis            |
| `TEST_STORAGE_ENDPOINT`         | Storage suite             | No     | Dedicated non-production S3-compatible endpoint   |
| `TEST_STORAGE_BUCKET`           | Storage suite             | No     | Dedicated test bucket (never production)          |
| `TEST_STORAGE_ACCESS_KEY`       | Storage suite             | Yes    | Test-only access key                              |
| `TEST_STORAGE_SECRET_KEY`       | Storage suite             | Yes    | Test-only secret key                              |
| `TEST_STORAGE_REGION`           | Storage suite             | No     | Optional region (default `us-east-1`)             |
| `TEST_STORAGE_PUBLIC_BASE_URL`  | Storage suite             | No     | Optional public base for URL derivation           |
| `INTEGRATION_ALLOW_DESTRUCTIVE` | Destructive reset helpers | No     | Extra opt-in for truncate/reset-style operations  |

Canonical taxonomy, isolation, and CI rules live in [testing.md](testing.md).

### Operator Admin bootstrap variables (not Nest runtime config)

Consumed only by `pnpm admin:create`. Never validated by `validateEnvironment`. Never logged. Never defaulted from `JWT_ACCESS_SECRET` or other application secrets.

| Variable                        | Purpose                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `EGGSHIP_ADMIN_CREATE_EMAIL`    | Canonical Admin email                                                        |
| `EGGSHIP_ADMIN_CREATE_PASSWORD` | Password for non-interactive use (prefer a hidden TTY prompt)                |
| `EGGSHIP_ADMIN_CREATE_ROLE`     | Explicit known `AdminRole` (no default)                                      |
| `EGGSHIP_ADMIN_CREATE_CONFIRM`  | `yes` in development/test; `I_UNDERSTAND_PRODUCTION:<db-host>` in production |

Root structured logs include `environment` = `NODE_ENV`, plus `version` and `gitSha`. Never log full `DATABASE_URL`, `REDIS_URL`, `TEST_DATABASE_URL`, `TEST_REDIS_URL`, passwords, or tokens.

## Build and release metadata

Canonical project version identity is `package.json` plus the matching Git tag and changelog section (see [releases](releases.md)). Runtime `APP_VERSION` / `GIT_SHA` must mirror the deployed release and commit; they are not a competing hand-edited version source for production.

| Context              | `APP_VERSION`                           | `GIT_SHA`                                     |
| -------------------- | --------------------------------------- | --------------------------------------------- |
| Local development    | Often matches current `package.json`    | Safe sentinel such as `local`                 |
| CI / OpenAPI tooling | Synthetic SemVer as set by the tool     | Tool-specific sentinel or `${{ github.sha }}` |
| Staging / production | Injected release version (tag/`vX.Y.Z`) | Exact commit SHA that produced the build      |

Do not require developers to manually update `GIT_SHA` for every commit. Future Liara deploy tasks should inject both values from the build.

## Local `.env` workflow

1. Copy the example file (do not invent credentials):
   - Windows PowerShell: `Copy-Item .env.example .env`
   - POSIX: `cp .env.example .env`
2. Fill required values for **development** infrastructure only.
3. Keep `.env` gitignored. Never commit it.
4. `.env.example` stays committed with names and comments only—no real secrets.

### Environment file policy

| File              | Policy                                                                |
| ----------------- | --------------------------------------------------------------------- |
| `.env`            | Developer-local secrets; gitignored; required for local `start:dev`   |
| `.env.example`    | Committed template; safe comments and empty/safe placeholders only    |
| `.env.local`      | Not used by this repository; do not introduce without a concrete need |
| `.env.test`       | Not used; Jest setup forces test values in process env                |
| `.env.production` | Not used; production secrets belong in Liara, not the repository      |

Prefer one local `.env`. Do not create a collection of env files unless a later task proves they are necessary.

## Development topology

Docker is **not** required for normal development.

```text
NestJS API (local pnpm)
        │
        ├── DEVELOPMENT PostgreSQL (eggship) via DATABASE_URL
        └── DEVELOPMENT Redis (127.0.0.1:6379) via REDIS_URL when needed
```

### Local integration topology

Integration tests use **separate** TEST resources that must not overlap development/runtime targets:

```text
pnpm test:integration*
        │
        ├── TEST PostgreSQL (eggship_test) via TEST_DATABASE_URL
        └── TEST Redis (127.0.0.1:6380) via TEST_REDIS_URL when required
```

The harness rejects `TEST_DATABASE_URL` that targets the same PostgreSQL endpoint/database as `DATABASE_URL`, and rejects `TEST_REDIS_URL` that targets the same Redis endpoint/logical database as `REDIS_URL`. Loopback aliases (`localhost`, `127.0.0.1`, `::1`) are treated as equivalent for this check.

### PostgreSQL strategies

1. **Preferred:** dedicated remote development PostgreSQL
   - Separate from production and staging
   - Separate credentials, never committed
   - Safe to migrate/reset during development
   - Must never contain production customer data
   - Configured only through local `.env`
2. **Optional:** native local PostgreSQL installation
3. **Optional only:** Docker Compose PostgreSQL (`docker-compose.yml`) for contributors who already use Docker

Do not require a local PostgreSQL install when a remote development database is available.

### Redis

- Absent/blank `REDIS_URL` → API starts without Redis.
- Configured `REDIS_URL` → connect at startup or fail loudly.
- Development must use dedicated development Redis only—**never production Redis**.

## Environment safety guardrails

Reliable automated protections in this repository:

- Central validation of `NODE_ENV`, URL protocols, and required fields.
- When `NODE_ENV=test`, Nest `ConfigModule` sets `ignoreEnvFile: true` so a developer `.env` cannot reintroduce `REDIS_URL` / `DATABASE_URL` after test setup clears them.
- Jest unit and e2e `setupFiles` force synthetic test values and delete Redis/OpenAPI overrides.
- OpenAPI CLI/process bootstrap overwrites ambient env with non-routable targets.
- Real infrastructure suites require `INTEGRATION_TESTS_ENABLED=true` and dedicated `TEST_*` URLs; they refuse to reuse `DATABASE_URL` / `REDIS_URL`.
- When both Redis URLs are visible, integration setup rejects `TEST_REDIS_URL` targeting the same Redis endpoint/database as `REDIS_URL`. Integration setup never copies the runtime URL as its test target.
- When both PostgreSQL URLs are visible, integration setup rejects `TEST_DATABASE_URL` targeting the same PostgreSQL endpoint/database as `DATABASE_URL`.
- PostgreSQL integration setup explicitly uses `DATABASE_POOL_MAX=32` for the 20-way order-create stampede. This test-only budget does not change runtime defaults.

Documented limitations (not guessed automatically):

- The API cannot reliably detect that a hostname is “production” without an explicit, reviewed marking scheme.
- Integration guards reject only explicit production-marked DNS labels and reserved non-routable hosts; humans must still never copy production credentials into TEST variables.
- Agents and humans must not copy production credentials into development `.env`.
- Destructive Prisma or integration reset operations require an explicitly identified non-production target (`INTEGRATION_ALLOW_DESTRUCTIVE` for integration resets).

## Migrations

| Context                        | Command                           | Notes                              |
| ------------------------------ | --------------------------------- | ---------------------------------- |
| Create a development migration | `pnpm prisma:migrate:dev`         | Review and commit migration files  |
| Apply migrations in deployment | `pnpm prisma:migrate:deploy`      | Staging/production approved path   |
| Generate Prisma Client         | `pnpm prisma:generate`            | Needed after schema/client changes |
| Format / validate schema       | `pnpm prisma:format` / `validate` | Local hygiene                      |

Never use `prisma db push` for production or staging deployment. Do not invent business migrations in environment-workflow work.

## Seed policy

There is no seed runner in this repository today. Future seed scripts, if added, must:

- use synthetic development data only;
- never copy production PII;
- be deterministic where practical;
- refuse to run when the target environment is production (or otherwise unidentified).

Production must never accidentally execute development seed scripts.

## Tests and infrastructure

| Command                          | Remote PostgreSQL              | Remote Redis                | Notes                                              |
| -------------------------------- | ------------------------------ | --------------------------- | -------------------------------------------------- |
| `pnpm test`                      | Not required                   | Not required                | Uses forced test env; ignores `.env`               |
| `pnpm test:e2e`                  | Not required                   | Not required                | Prisma/Redis overridden or disabled                |
| `pnpm test:integration`          | Required (`TEST_DATABASE_URL`) | Required (`TEST_REDIS_URL`) | Opt-in; fails closed when config/infra missing     |
| `pnpm test:integration:postgres` | Required                       | Not required                | Prisma migrate deploy + PostgreSQL probes          |
| `pnpm test:integration:redis`    | Not required                   | Required                    | Redis + BullMQ infrastructure probes               |
| `pnpm test:integration:storage`  | Not required                   | Not required                | Opt-in S3-compatible TEST bucket; never production |

Ordinary suites must not silently connect to the developer `.env` database or Redis. Integration details live in [testing.md](testing.md).

## Liara boundary (documentation only)

| Location          | Configuration source                                     |
| ----------------- | -------------------------------------------------------- |
| Local development | Developer `.env`                                         |
| Liara staging     | Liara-managed environment variables and secrets          |
| Liara production  | Separate Liara-managed environment variables and secrets |

Do not embed Liara credentials or deployment commands here.

## Developer checks

`pnpm env:check` verifies Node/pnpm engines, `.env` presence/gitignore status, required variable names, URL protocols, and prints **masked** connection metadata only. It does not require Docker, contact production, mutate databases, print secrets, or install system software.

## Agent rules

- Never invent environment credentials or paste production secrets into development config.
- Never run destructive database migrate/reset/seed commands against an unidentified environment.
- Before destructive data operations, the environment identity must be explicit (local development or named non-production target).
- Do not require Docker for EggShip local development.
